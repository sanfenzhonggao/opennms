/**
 * Base URL of the REST service.
 */
var BASE_REST_URL = 'api/v2';

/**
 * ISO-8601 date format string.
 */
var ISO_8601_DATE_FORMAT_WITHOUT_MILLIS = 'yyyy-MM-ddTHH:mm:ssZ';

/**
 * Function used to append an extra transformer to the default $http transforms.
 */
function appendTransform(defaultTransform, transform) {
	defaultTransform = angular.isArray(defaultTransform) ? defaultTransform : [ defaultTransform ];
	return defaultTransform.concat(transform);
}

/**
 * Convert from a clause into a FIQL query string.
 */
function toFiql(clauses) {
	var first = true;
	var fiql = '';
	for (var i = 0; i < clauses.length; i++) {
		if (!first) {
			fiql += ';';
		}
		fiql += clauses[i].property;

		switch (clauses[i].operator) {
		case 'EQ':
			fiql += '=='; break;
		case 'NE':
			fiql += '!='; break;
		case 'LT':
			fiql += '=lt='; break;
		case 'LE':
			fiql += '=le='; break;
		case 'GT':
			fiql += '=gt='; break;
		case 'GE':
			fiql += '=ge='; break;
		}

		fiql += escapeSearchValue(clauses[i].value);

		first = false;
	}
	return fiql;
}

/**
 * Escape FIQL reserved characters by URL-encoding them. Reserved characters are:
 * <ul>
 * <li>!</li>
 * <li>$</li>
 * <li>'</li>
 * <li>(</li>
 * <li>)</li>
 * <li>*</li>
 * <li>+</li>
 * <li>,</li>
 * <li>;</li>
 * <li>=</li>
 * </ul>
 * @param value
 * @returns String with reserved characters URL-encoded
 */
function escapeSearchValue(value) {
	return value
		.replace('!', '%21')
		.replace('$', '%24')
		.replace("'", '%27')
		.replace('(', '%28')
		.replace(')', '%29')
		// People are going to type this in as a wildcard, so I 
		// guess they'll have to type in '%2A' if they want to
		// match an asterisk...
		//.replace('*', '%2A')
		.replace('+', '%2B')
		.replace(',', '%2C')
		.replace(';', '%3B')
		.replace('=', '%3D');
}

/**
 * Parse an HTTP Content-Range header into the start, end, and total fields.
 * The header should be in a format like: "items 0-14/28".
 * 
 * @param contentRange String from the Content-Range header
 */
function parseContentRange(contentRange) {
	if (typeof contentRange === 'undefined' || contentRange === null) {
		return {start: 0, end: 0, total: 0};
	}
	// Example: items 0-14/28
	var pattern = /items\s+?(\d+)\s*\-\s*(\d+)\s*\/\s*(\d+)/;
	return {
		start: Number(contentRange.replace(pattern, '$1')),
		end: Number(contentRange.replace(pattern, '$2')),
		total: Number(contentRange.replace(pattern, '$3'))
	};
}


(function() {
	'use strict';
	
	var MODULE_NAME = 'onmsList';

	String.prototype.endsWith = function(suffix) {
		return this.indexOf(suffix, this.length - suffix.length) !== -1;
	};

	// $filters that can be used to create human-readable versions of filter values
	angular.module('onmsListFilters', [])
	.filter('operator', function() {
		return function(input, value) {
			// See if the string contains a wildcard
			var fuzzy = (typeof value === 'String' && value.indexOf('*') > -1);

			switch (input) {
			case 'EQ':
				return fuzzy ? 'is like' : 'equals';
			case 'NE':
				return fuzzy ? 'is not like' : 'does not equal';
			case 'LT':
				return 'is less than';
			case 'LE':
				return 'is less than or equal';
			case 'GT':
				return 'is greater than';
			case 'GE':
				return 'is greater than or equal';
			}
			// If no match, return the input
			return input;
		}
	});

	// List module
	angular.module(MODULE_NAME, [ 'ngResource' ])

	.config(function($locationProvider) {
		$locationProvider.html5Mode({
			// Use HTML5 
			enabled: true,
			// Don't rewrite all <a> links on the page
			rewriteLinks: false
		});
	})

	/**
	 * Generic list controller
	 */
	.controller('ListCtrl', ['$scope', '$location', '$window', '$log', '$filter', function($scope, $location, $window, $log, $filter) {
		$log.debug('ListCtrl initializing...');

		$scope.DEFAULT_LIMIT = 20;
		$scope.DEFAULT_OFFSET = 0;
		$scope.DEFAULT_ORDERBY = '';
		$scope.DEFAULT_ORDER = 'asc';

		// Blank out the editing flags
		$scope.enableEditLabel = false;
		$scope.enableEditLocation = false;
		$scope.enableEditProperties = false;

		// Restore any query parameters that you can from the 
		// query string, blank out the rest
		$scope.query = {
			// TODO: Figure out how to parse and restore the FIQL search param
			searchParam: '',
			searchClauses: [],
			limit: typeof $location.search().limit === 'undefined' ? $scope.DEFAULT_LIMIT : (Number($location.search().limit) > 0 ? Number($location.search().limit) : $scope.DEFAULT_LIMIT),
			newLimit: typeof $location.search().limit === 'undefined' ? $scope.DEFAULT_LIMIT : (Number($location.search().limit) > 0 ? Number($location.search().limit) : $scope.DEFAULT_LIMIT),
			offset: typeof $location.search().offset === 'undefined' ? $scope.DEFAULT_OFFSET : (Number($location.search().offset) > 0 ? Number($location.search().offset) : $scope.DEFAULT_OFFSET),

			lastOffset: 0,
			maxOffset: 0,

			// TODO: Validate that the orderBy is in a list of supported properties
			orderBy: typeof $location.search().orderBy === 'undefined' ? $scope.DEFAULT_ORDERBY : $location.search().orderBy,
			order: typeof $location.search().order === 'undefined' ? $scope.DEFAULT_ORDER : ($location.search().order === 'asc' ? 'asc' : 'desc')
		};

		// Sync the query hash with the $location query string
		$scope.$watch('query', function() {
			var queryParams = angular.copy($scope.query);

			// Delete derived values that we don't need in the query string
			delete queryParams.searchClauses;
			delete queryParams.newLimit;
			delete queryParams.lastOffset;
			delete queryParams.maxOffset;

			// Rename searchParam to _s
			queryParams._s = queryParams.searchParam === '' ? null : queryParams.searchParam;
			delete queryParams.searchParam;

			// Delete any parameters that have default or blank values
			if (queryParams.limit === $scope.DEFAULT_LIMIT || queryParams.limit === '') { delete queryParams.limit; }
			if (queryParams.offset === $scope.DEFAULT_OFFSET || queryParams.offset === '') { delete queryParams.offset; }
			if (queryParams.orderBy === $scope.DEFAULT_ORDERBY || queryParams.orderBy === '') { delete queryParams.orderBy; }
			if (queryParams.order === $scope.DEFAULT_ORDER || queryParams.order === '') { delete queryParams.order; }
			if (queryParams._s === '') { delete queryParams._s; }

			$location.search(queryParams);
		}, 
		true // Use object equality because the reference doesn't change
		);

		// Go out of edit mode
		$scope.unedit = function() {
			$scope.enableEditLabel = false;
			$scope.enableEditLocation = false;
			$scope.refresh();
		}

		// Mark label as editable
		// TODO: Change this so that it uniquely edits one table cell
		$scope.editLabel = function(id) {
			$log.debug(id);
			$scope.enableEditLabel = true;
		}

		// Mark location as editable
		// TODO: Change this so that it uniquely edits one table cell
		$scope.editLocation = function(id) {
			$log.debug(id);
			$scope.enableEditLocation = true;
		}

		// Add the search clause to the list of clauses
		$scope.addSearchClause = function(clause) {
			if(angular.isDate(clause.value)) {
				// Returns a value in yyyy-MM-ddTHH:mm:ss.sssZ format
				// Unfortunately, I don't think CXF will like this because
				// it includes the millisecond portion of the date.
				//clause.value = new Date(clause.value).toISOString();

				// TODO: Add milliseconds to this timestamp once CXF can parse it
				clause.value = $filter('date')(new Date(clause.value), ISO_8601_DATE_FORMAT_WITHOUT_MILLIS);
			}

			// Make sure the clause isn't already in the list of search clauses
			for (var i = 0; i < $scope.query.searchClauses.length; i++) {
				if (
					clause.property === $scope.query.searchClauses[i].property &&
					clause.operator === $scope.query.searchClauses[i].operator &&
					clause.value === $scope.query.searchClauses[i].value
				) {
					return;
				}
			}
			// TODO: Add validation?
			$scope.query.searchClauses.push(angular.copy(clause));
			$scope.query.searchParam = toFiql($scope.query.searchClauses);
			$scope.refresh();
		}

		// Convert an epoch timestamp into String format before adding the search clause
		$scope.addEpochTimestampSearchClause = function(clause) {
			// TODO: Add milliseconds to this timestamp once CXF can parse it
			clause.value = $filter('date')(clause.value, ISO_8601_DATE_FORMAT_WITHOUT_MILLIS);
			$scope.addSearchClause(clause);
		}

		// Remove a search clause from the list of clauses
		$scope.removeSearchClause = function(clause) {
			// TODO: Add validation?
			$scope.query.searchClauses.splice($scope.query.searchClauses.indexOf(clause), 1);
			$scope.query.searchParam = toFiql($scope.query.searchClauses);
			$scope.refresh();
		}

		// Clear the current search
		$scope.clearSearch = function() {
			if ($scope.query.searchClauses.length > 0) {
				$scope.query.searchClauses = [];
				$scope.query.searchParam = '';
				$scope.refresh();
			}
		}

		// Change the sorting of the table
		$scope.changeOrderBy = function(property) {
			if ($scope.query.orderBy === property) {
				// TODO: Figure out if we should reset limit/offset here also
				// If the property is already selected then reverse the sorting
				$scope.query.order = ($scope.query.order === 'asc' ? 'desc' : 'asc');
			} else {
				// TODO: Figure out if we should reset limit/offset here also
				$scope.query.orderBy = property;
				$scope.query.order = $scope.DEFAULT_ORDER;
			}
			$scope.refresh();
		}

		$scope.setOffset = function(offset) {
			// Offset of the last page
			var lastPageOffset;
			if ($scope.query.maxOffset < 0) { 
				offset = 0;
				lastPageOffset = 0; 
			} else {
				lastPageOffset = Math.floor($scope.query.maxOffset / $scope.query.limit) * $scope.query.limit; 
			}

			// Bounds checking
			offset = ((offset < 0) ? 0 : offset);
			offset = ((offset > lastPageOffset) ? lastPageOffset : offset);

			if ($scope.query.offset !== offset) {
				$scope.query.offset = offset;
				$scope.refresh();
			}
		}

		$scope.setLimit = function(limit) {
			if (limit < 1) {
				$scope.query.newLimit = $scope.query.limit;
				// TODO: Throw a validation error
				return;
			}
			if ($scope.query.limit !== limit) {
				$scope.query.limit = limit;
				$scope.query.offset = Math.floor($scope.query.offset / limit) * limit;
				$scope.refresh();
			}
		}

		// Override this to implement updates to an object
		$scope.refresh = function() {
			$log.warn("You need to override $scope.$parent.refresh() in your controller");
		}

		// Override this to implement updates to an object
		$scope.update = function() {
			$log.warn("You need to override $scope.$parent.update() in your controller");
		}

		$log.debug('ListCtrl initialized');
	}])

	.run(['$rootScope', '$log', function($rootScope, $log) {
		$log.debug('Finished initializing ' + MODULE_NAME);
	}])

	;

	/*
	angular.element(document).ready(function() {
		console.log('Bootstrapping ' + MODULE_NAME);
		angular.bootstrap(document, [MODULE_NAME]);
	});
	*/
}());
