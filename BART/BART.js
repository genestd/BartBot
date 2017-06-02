'use strict'

var httpRequest = require('request')
var xmlParser = require('xml2js')
var async = require('async')
var _ = require('lodash')
var every = require('schedule').every

var BART = (function BARTModule(){


/* BART API variables */
var bartApiBaseUrl = 'http://api.bart.gov/api';
// This is a demo key use environment if possible
var bartApiKey = process.env.BART_API_KEY || 'MW9S-E7SL-26DU-VV8V';
var apiContext = '/api';
var bartApiTimeout = 10000;
var stationsInfo = undefined;

var infoCache = {
	stationList: undefined,
	stationInfo: undefined,
	stationAccess: undefined,
	elevatorStatus: undefined,

	getStationList: function() {
		return this.stationList;
	},

	updateStationList: function(newStationList) {
		this.stationList = newStationList;
	},

	getStationInfo: function() {
		return this.stationInfo;
	},

	updateStationInfo: function(newStationInfo) {
		this.stationInfo = newStationInfo;
	},

	getStationAccess: function() {
		return this.stationAccess;
	},

	updateStationAccess: function(newStationAccess) {
		this.stationAccess = newStationAccess;
	},

	getElevatorStatus: function() {
		return this.elevatorStatus;
	},

	updateElevatorStatus: function(newElevatorStatus) {
		this.elevatorStatus = newElevatorStatus;
	}
};/* End infoCache object */

/**
*  Function to return the distance between 2 objects (i.e. user and station)
**/
function getDistance(latUser, lonUser, latStation, lonStation) {
	var R = 6371;
	var dLat = (latStation - latUser).toRad();
	var dLon = (lonStation - lonUser).toRad();
	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        	Math.cos(latStation.toRad()) * Math.cos(latUser.toRad()) *
        	Math.sin(dLon / 2) * Math.sin(dLon / 2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	var d = R * c;

	return d * 0.621371;
};

/**
* Name: getStationName
* Param: abbr - string abbreviation for a station
* Return: String or undefined
* Logic: Given a station abbreviation, loop through current station list.  Return first matching station,
*   or undefined if no match is found
**/
function getStationName(abbr) {
	//see bart api for structure.  In this case, ".station" is an array of station objects
	var stations = infoCache.getStationList().station;
	var n = 0;

	for (n = 0; n < stations.length; n++) {
		if (stations[n].abbr === abbr) {
			return stations[n].name;
		}
	}

	return undefined;
}

/**
* Name: buildHttpRequestOptions
* Param: requestUrl - string abbreviation for the specific BART API command being requested
* Return: Object that can be passed as first argument to a "request" call
* Logic: Builds the basic URI string from default values plus the requestUrl param.
*		The result is an object that the request package can use to access BART API
**/
function buildHttpRequestOptions(requestUrl) {
	return {
		uri: bartApiBaseUrl + '/' + requestUrl + '&key=' + bartApiKey,
		method: 'GET',
		timeout: bartApiTimeout,
		followRedirect: true,
		maxRedirects: 10
	};
};
/**
* Name: loadElevatorStatus
* Param: none
* Return: none
* Logic: Builds a URI to get the status of BART station elevators.  API response is parsed
* 	and stored in infoCache object
* Notes: Not currently used by BartBot code
**/
function loadElevatorStatus() {
	console.log('Refreshing Elevator status cache...');
	httpRequest(
		buildHttpRequestOptions('bsa.aspx?cmd=elev'),
		function(error, resp, body) {
			// TODO non-happy path
			xmlParser.parseString(body, { trim: true, explicitArray: false, attrkey: 'id' }, function(err, res) {
				infoCache.updateElevatorStatus(res.root);
				console.log('Elevator status cache refreshed.');
			});
		}
	);
}

/**
* Name: loadStationList
* Param: none
* Return: none
* Logic: Builds a URI to get the list of BART stations.  API response is parsed
* 	and stored in infoCache object.  Immediately calls successor function getStationInfoAndAccess()
*   to make individual API calls for each station
**/
function loadStationList() {
	console.log('Refreshing Station List cache...');
	httpRequest(
		buildHttpRequestOptions('stn.aspx?cmd=stns'),
		function(error, resp, body) {
			// TODO non-happy path

			// API still returns COLS incorrectly as 'Coliseum/Oakland Airport'
			// fixes this to correct new name 'Coliseum'
			body = body.replace('Coliseum/Oakland Airport', 'Coliseum');

			xmlParser.parseString(body, { trim: true, explicitArray: false }, function(err, res) {
				infoCache.updateStationList(res.root.stations);

				console.log('Station List cache refreshed.');
				getStationInfoAndAccess();
			});
		}
	);
};

function getStationInfoAndAccess() {
	var stations = infoCache.getStationList().station;
	var stationInfoURLs = [];
	var stationAccessURLs = [];
	var stationAccess = [];
	var stationInfo = [];

	console.log('Getting station information...');

	for (var n = 0; n < stations.length; n++) {
		var thisStation = stations[n];
		stationInfoURLs.push('stn.aspx?cmd=stninfo&orig=' + thisStation.abbr);
		stationAccessURLs.push('stn.aspx?cmd=stnaccess&orig=' + thisStation.abbr);
	}

	async.each(
		stationAccessURLs,
		function(stationAccessURL, callback) {
			httpRequest(
				buildHttpRequestOptions(stationAccessURL),
				function(error, resp, body) {
					if (stationAccessURL.indexOf('COLS') > -1) {
						// API still returns COLS incorrectly as 'Coliseum/Oakland Airport'
						// fixes this to correct new name 'Coliseum'
						body = body.split('Coliseum/Oakland Airport').join('Coliseum');
					}

					xmlParser.parseString(body, { trim: true, explicitArray: false, attrkey: 'flags' }, function(err, res) {
						stationAccess.push(res.root.stations.station);
						callback();
					});
				}
			);
		},
		function(err) {
			stationAccess = _.sortBy(stationAccess, 'name');
			infoCache.updateStationAccess(stationAccess);
			console.log('Station Access cache refreshed.');
		}
	);

	async.each(
		stationInfoURLs,
		function(stationInfoURL, callback) {
			httpRequest(
				buildHttpRequestOptions(stationInfoURL),
				function(error, resp, body) {
					if (stationInfoURL.indexOf('COLS') > -1) {
						// API still returns COLS incorrectly as 'Coliseum/Oakland Airport'
						// fixes this to correct new name 'Coliseum'
						body = body.split('Coliseum/Oakland Airport').join('Coliseum');
					}

					xmlParser.parseString(body, { trim: true, explicitArray: false }, function(err, res) {
						// TODO Single array item fixes...
						stationInfo.push(res.root.stations.station);
						callback();
					});
				}
			);
		},
		function(err) {
			stationInfo = _.sortBy(stationInfo, 'name');
			infoCache.updateStationInfo(stationInfo);
			console.log('Station Info cache refreshed.');
		}
	);
};

/**
* Name: getServiceAnnouncements
* Param: cb: a callback function
* Return: cb(): execute callback with the data returned from BART
* Logic: Queries BART API for service announcements.  API response is parsed
* 	and announcements are converted to an array if necessary.
**/
function getServiceAnnouncements( cb ){
  httpRequest(
    buildHttpRequestOptions('bsa.aspx?cmd=bsa&date=today'),
    function(error, resp, body) {
      // TODO non happy path
      var xmlServiceAnnouncements = xmlParser.parseString(body, { trim: true, explicitArray: false }, function(err, res) {
        if (err){
          return cb(err)
        }
        var newArray = [];

        // Fix single bsa to be an array
        if (! Array.isArray(res.root.bsa)) {
          newArray.push(res.root.bsa);
          res.root.bsa = newArray;
        }
        //res.root.bsa = res.root.bsa.reverse();

        return cb(null, res.root)
      });
    }
  );
}

/**
* Name: getStations
* Param: cb: a callback function
* Return: cb(): execute callback with the data returned from BART
* Logic: Station list is pulled from the data cache...this data is refreshed at startup, and every 24hours
**/
  function getStations( cb ){
    let stations = infoCache.getStationList().station;
    cb(null, stations)
  }

/**
* Name: status
* Param: cb: a callback function
* Return: cb(): execute callback with the data returned from BART
* Logic: This function returns a count of trains active in the BART system.
**/
	  function status(cb){
  	httpRequest( buildHttpRequestOptions('bsa.aspx?cmd=count'), function(error, resp, body) {
  		if(error) return cb(error)
  		// TODO non-happy path
  		var xmlStatus = xmlParser.parseString(body, { trim: true, explicitArray: false }, function(err, res) {
  			if(err) return cb(err)
  			cb(null, res.root)
  		});
  	});
  }

/**
* Name: stationByLocation
* Param: lat - user latitude
* Param: lng - user longitude
* Param: cb - a callback function
* Return: cb(): execute callback with the ID of the closest station
* Logic: Get the station list from Info Cache.  Check the distance from user lat/long for each station.
* 	Return the closest sttion. 
**/
  function stationByLocation(lat, lng, cb){
    var stations = infoCache.getStationList().station;
    var closestStation = {};
    var closestDistance = 999999.9;
    var userLatitude = parseFloat(lat);
    var userLongitude = parseFloat(lng);

    for (var n = 0; n < stations.length; n++) {
      var thisStation = stations[n];
      var thisDistance = getDistance(userLatitude, userLongitude, parseFloat(thisStation.gtfs_latitude), parseFloat(thisStation.gtfs_longitude));
      if (thisDistance < closestDistance) {
        closestStation = JSON.parse(JSON.stringify(thisStation));
        closestStation.distance = closestDistance;
        closestDistance = thisDistance;
      }
    }

    cb(null, closestStation);
  }

  // TODO Add the option to specify time/date?  If not specified use 'now'
  function getConnectionData( cnxn, cb){
    var fromStation = cnxn.start.toUpperCase(),
        toStation = cnxn.destination.toUpperCase();
    httpRequest(
      buildHttpRequestOptions('sched.aspx?cmd=depart&orig=' + fromStation + '&dest=' + toStation + '&time=now&b=0&a=1'),
        function(error, resp, body) {
          if (error) return cb(error)

          var xmlStations = xmlParser.parseString(body, { trim: true, explicitArray: false, attrkey: 'details' }, function(err, res) {
            var newArray = [];
            var n = 0;
            var leg = undefined;

            // For some reason this field comes through needing trimming still!
            res.root.schedule.request.trip.details.origTimeDate = res.root.schedule.request.trip.details.origTimeDate.trim();

            // Fix single leg object into an array so API returns an array
            // regardless of whether the trip is 1,2 or 3 legs
            if (! Array.isArray(res.root.schedule.request.trip.leg)) {
              newArray.push(res.root.schedule.request.trip.leg);
              res.root.schedule.request.trip.leg = newArray;
            }

            // Enrich legs with full station names for origin, destination, trainHeadStation
            for (n = 0; n < res.root.schedule.request.trip.leg.length; n++) {
              leg = res.root.schedule.request.trip.leg[n];
              leg.details.originName = getStationName(leg.details.origin);
              leg.details.destinationName = getStationName(leg.details.destination);
              leg.details.trainHeadStationName = getStationName(leg.details.trainHeadStation);
            }

            // Calculate trip duration
            var startDate = new Date(res.root.schedule.request.trip.details.origTimeDate + ' ' + res.root.schedule.request.trip.details.origTimeMin);
            var endDate = new Date(res.root.schedule.request.trip.details.destTimeDate + ' ' + res.root.schedule.request.trip.details.destTimeMin);

            res.root.schedule.request.trip.details.duration = ((endDate - startDate) / 60000)

            cb(null, res.root);
          }); //end xml parser callback
        }); //end httprequest callback
  }

  // Prime the station list on startup and read periodically
  loadStationList();
  	every('24h').do(function() {
    loadStationList();
  });

  // Prime the elevator status on startup and read periodically
  loadElevatorStatus();
  	every('15m').do(function() {
    loadElevatorStatus();
  });

	/**
	* toRad polyfill
	**/
  if (typeof(Number.prototype.toRad) === 'undefined') {
    Number.prototype.toRad = function() {
      return this * (Math.PI / 180);
    }
  }

  /**
	*  Public Interface to the BART Module
	**/
  return {
  getServiceAnnouncements: getServiceAnnouncements,
  getStations: getStations,
  status: status,
  stationByLocation: stationByLocation,
  getConnectionData: getConnectionData
}

})()
module.exports = BART
