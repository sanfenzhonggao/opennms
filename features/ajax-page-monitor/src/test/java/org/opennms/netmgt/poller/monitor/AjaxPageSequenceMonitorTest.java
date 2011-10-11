package org.opennms.netmgt.poller.monitor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.HashMap;
import java.util.Map;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.opennms.core.utils.InetAddressUtils;
import org.opennms.netmgt.model.PollStatus;
import org.opennms.netmgt.poller.InetNetworkInterface;
import org.opennms.netmgt.poller.MonitoredService;
import org.opennms.netmgt.poller.NetworkInterface;
import org.opennms.netmgt.poller.monitors.AjaxPageSequenceMonitor;


public class AjaxPageSequenceMonitorTest {
	
	
	public static class MockMonService implements MonitoredService{
	    
	    private int m_nodeId;
        private String m_nodeLabel;
        private InetAddress m_inetAddr;
        private String m_svcName;
        private String m_ipAddr;

        public MockMonService(int nodeId, String nodeLabel, InetAddress inetAddress, String svcName) throws UnknownHostException {
	        m_nodeId = nodeId;
	        m_nodeLabel = nodeLabel;
	        m_inetAddr = inetAddress;
	        m_svcName = svcName;
	        m_ipAddr = InetAddressUtils.str(m_inetAddr);
	    }
	    
        @Override
        public String getSvcUrl() {
            return null;
        }

        @Override
        public String getSvcName() {
            return m_svcName;
        }

        @Override
        public String getIpAddr() {
            return m_ipAddr;
        }

        @Override
        public int getNodeId() {
            return m_nodeId;
        }

        @Override
        public String getNodeLabel() {
            return m_nodeLabel;
        }

        @Override
        public NetworkInterface<InetAddress> getNetInterface() {
            return new InetNetworkInterface(m_inetAddr);
        }

        @Override
        public InetAddress getAddress() {
            return m_inetAddr;
        }
	    
	}
	
	@Before
	public void setup() throws Exception{
		
	}
	
	@Test
	public void testPollStatusNotNull() throws UnknownHostException{
	    MonitoredService monSvc = new MockMonService(1, "papajohns", InetAddress.getByName("http://www.papajohns.co.uk"), "PapaJohnsSite");
	    
	    System.out.println("monSvc.getSvcUrl: " + monSvc.getSvcUrl());
	    
	    Map<String, Object> params = new HashMap<String, Object>();
	    params.put("selenium-test", "src/main/resources/groovy/SeleniumGroovyTest.groovy");
	    params.put("base-url", "${ipAddr}");
	    
		AjaxPageSequenceMonitor ajaxPSM = new AjaxPageSequenceMonitor();
		PollStatus pollStatus = ajaxPSM.poll(monSvc, params);
		
		assertNotNull("PollStatus must not be null", pollStatus);
		
		System.err.println("PollStatus message: " + pollStatus.getReason());
		assertEquals(PollStatus.available(), pollStatus);
		
	}
	
	
	
	@After
	public void tearDown(){
		
	}
}
