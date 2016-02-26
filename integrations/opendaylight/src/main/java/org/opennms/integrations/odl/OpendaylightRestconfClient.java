/*******************************************************************************
 * This file is part of OpenNMS(R).
 *
 * Copyright (C) 2016 The OpenNMS Group, Inc.
 * OpenNMS(R) is Copyright (C) 1999-2016 The OpenNMS Group, Inc.
 *
 * OpenNMS(R) is a registered trademark of The OpenNMS Group, Inc.
 *
 * OpenNMS(R) is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * OpenNMS(R) is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with OpenNMS(R).  If not, see:
 *      http://www.gnu.org/licenses/
 *
 * For more information contact:
 *     OpenNMS(R) Licensing <license@opennms.org>
 *     http://www.opennms.org/
 *     http://www.opennms.com/
 *******************************************************************************/

package org.opennms.integrations.odl;

import java.io.IOException;
import java.io.StringReader;
import java.util.Objects;

import org.apache.http.HttpEntity;
import org.apache.http.HttpHost;
import org.apache.http.HttpResponse;
import org.apache.http.ParseException;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.util.EntityUtils;
import org.opendaylight.mdsal.binding.dom.codec.api.BindingCodecTreeNode;
import org.opendaylight.mdsal.binding.dom.codec.api.BindingNormalizedNodeCodec;
import org.opendaylight.yang.gen.v1.urn.tbd.params.xml.ns.yang.network.topology.rev131021.NetworkTopology;
import org.opendaylight.yang.gen.v1.urn.tbd.params.xml.ns.yang.network.topology.rev131021.NodeId;
import org.opendaylight.yang.gen.v1.urn.tbd.params.xml.ns.yang.network.topology.rev131021.TopologyId;
import org.opendaylight.yang.gen.v1.urn.tbd.params.xml.ns.yang.network.topology.rev131021.network.topology.topology.Node;
import org.opendaylight.yangtools.binding.data.codec.gen.impl.StreamWriterGenerator;
import org.opendaylight.yangtools.binding.data.codec.impl.BindingNormalizedNodeCodecRegistry;
import org.opendaylight.yangtools.sal.binding.generator.impl.ModuleInfoBackedContext;
import org.opendaylight.yangtools.sal.binding.generator.util.BindingRuntimeContext;
import org.opendaylight.yangtools.sal.binding.generator.util.JavassistUtils;
import org.opendaylight.yangtools.yang.binding.DataObject;
import org.opendaylight.yangtools.yang.binding.InstanceIdentifier;
import org.opendaylight.yangtools.yang.binding.util.BindingReflections;
import org.opendaylight.yangtools.yang.data.api.schema.stream.NormalizedNodeStreamWriter;
import org.opendaylight.yangtools.yang.data.codec.gson.JsonParserStream;
import org.opendaylight.yangtools.yang.data.impl.schema.ImmutableNormalizedNodeStreamWriter;
import org.opendaylight.yangtools.yang.data.impl.schema.NormalizedNodeResult;
import org.opendaylight.yangtools.yang.model.api.SchemaContext;
import org.opennms.core.web.HttpClientWrapper;

import com.google.common.base.Charsets;
import com.google.gson.stream.JsonReader;

import javassist.ClassPool;

/**
 * Java client for Opendaylight's RESTConf API.
 *
 * Uses Opendaylight's YANG tools for serializing/deserializing POJOs
 * to and from JSON.
 *
 * @author jwhite
 */
public class OpendaylightRestconfClient {
    public static final int DEFAULT_PORT = 8181;
    private static final InstanceIdentifier<NetworkTopology> NETWORK_TOPOLOGY_PATH = InstanceIdentifier.create(NetworkTopology.class);

    private static final SchemaContext s_schemaContext;
    private static final BindingCodecTreeNode<NetworkTopology> s_networkTopologyCodec;

    static {
        /*
         * This next block of code scans the class-path for .yang files in order to
         * generate the SchemaContext and then creates a codec registry.
         *
         * Inspired by org.opendaylight.yangtools.binding.data.codec.test.CachingCodecTest.
         *
         * #TOOMUCHMAGIC
         */
        ModuleInfoBackedContext ctx = ModuleInfoBackedContext.create();
        ctx.addModuleInfos(BindingReflections.loadModuleInfos());
        s_schemaContext = ctx.tryToCreateSchemaContext().get();
        BindingRuntimeContext runtimeContext = BindingRuntimeContext.create(ctx, s_schemaContext);
        final JavassistUtils utils = JavassistUtils.forClassPool(ClassPool.getDefault());
        BindingNormalizedNodeCodecRegistry registry = new BindingNormalizedNodeCodecRegistry(StreamWriterGenerator.create(utils));
        registry.onBindingRuntimeContextUpdated(runtimeContext);

        // Create codecs for the object we'll need to serialize/deserialize
        s_networkTopologyCodec = registry.getCodecContext().getSubtreeCodec(NETWORK_TOPOLOGY_PATH);
    }

    private final String m_host;
    private final int m_port;

    public OpendaylightRestconfClient(String host) {
        this(host, DEFAULT_PORT);
    }

    public OpendaylightRestconfClient(String host, int port) {
        m_host = Objects.requireNonNull(host);
        m_port = port;
    }

    private String doGet(HttpGet httpGet) throws ParseException, IOException {
        HttpClientWrapper httpClientBuilder = HttpClientWrapper.create()
            .addBasicCredentials("admin", "admin");
        try (CloseableHttpClient httpClient = httpClientBuilder.getClient()) {
            HttpHost target = new HttpHost(m_host, m_port, "http");
            HttpResponse httpResponse = httpClient.execute(target, httpGet);
            if (httpResponse.getStatusLine().getStatusCode() != 200) {
                throw new IOException("Get did not return a 200: " + httpResponse);
            }
            HttpEntity entity = httpResponse.getEntity();
            return EntityUtils.toString(entity, Charsets.UTF_8);
        }
    }

    public NetworkTopology getOperationalNetworkTopology() throws Exception {
        String json = doGet(new HttpGet("/restconf/operational/network-topology:network-topology/"));
        return deserializeJsonUsing(json, s_networkTopologyCodec);
    }

    public Node getNodeFromOperationalTopology(TopologyId topologyId, NodeId nodeId) throws Exception {
        return getNodeFromOperationalTopology(topologyId.getValue(), nodeId.getValue());
    }

    public Node getNodeFromOperationalTopology(String topologyId, String nodeId) throws Exception {
        return getOperationalNetworkTopology().getTopology().stream()
                .filter(t -> topologyId.equals(t.getTopologyId().getValue()))
                .flatMap(t -> t.getNode().stream())
                .filter(n -> nodeId.equals(n.getNodeId().getValue()))
                .findFirst().orElse(null);
        /* TODO: Make a specific call instead, currently fails with:
         * java.lang.IllegalArgumentException: Node (urn:ietf:params:xml:ns:netconf:base:1.0)data is not a simple type
         *  at com.google.common.base.Preconditions.checkArgument(Preconditions.java:148)
         *  at org.opendaylight.yangtools.yang.data.codec.gson.JsonParserStream.setValue(JsonParserStream.java:111)
         *  at org.opendaylight.yangtools.yang.data.codec.gson.JsonParserStream.read(JsonParserStream.java:125)
         *  at org.opendaylight.yangtools.yang.data.codec.gson.JsonParserStream.parse(JsonParserStream.java:87)
         *  at org.opennms.integrations.odl.OpendaylightRestconfClient.deserializeJsonUsing(OpendaylightRestconfClient.java:148)
        String json = doGet(new HttpGet(String.format("/restconf/operational/network-topology:network-topology/"
                + "topology/%s/node/%s", topologyId, nodeId)));
        return deserializeJsonUsing(json, m_nodeCodec);
        */
    }

    private <T extends DataObject> T deserializeJsonUsing(String json, BindingNormalizedNodeCodec<T> codec) {
        final NormalizedNodeResult result = new NormalizedNodeResult();
        final NormalizedNodeStreamWriter streamWriter = ImmutableNormalizedNodeStreamWriter.from(result);
 
        final JsonParserStream jsonParser = JsonParserStream.create(streamWriter, s_schemaContext);
        jsonParser.parse(new JsonReader(new StringReader(json)));

        return codec.deserialize(result.getResult());
    }
}