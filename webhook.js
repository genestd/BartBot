/*
	Resources that were used to build this prototype

		https://api.ai/
			~ Helps take user input and categorize it. Also provides access to conversational UI AI
		http://bart.crudworks.org/api/
			~ This API is a simpler more user friendly interface for Bart.
		http://www.girliemac.com/blog/2017/01/06/facebook-apiai-bot-nodejs/
			~ this is a helpful tutorial
		ngrok:
			~ this provides https/SSL, a requirement of Facebook messenger

	Other Notes

		https://github.com/simonprickett/bartfbchatbot -> Simon also built a chatbot which could be useful to follow along with. Current Implementation makes use of his API which could be modified and improved on.

*/
'use strict';
require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
var session = require('express-session')
const app = express();
const request = require('request');
const apiai = require('apiai');
const apiaiApp = apiai(process.env.AI_TOKEN);
const { getServiceAnnouncements, getWeather, getClosestStation, getAllStations, getConnectionData  } = require('./helpers/aiResponseProcessors')

/* packages required for BART API */
const cors = require('cors')
const path = require('path')
const BART = require('./BART/BART')

/* Express Middleware */
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'))
app.use(session({
  secret: "tuxedo_cat",
  resave: false,
  saveUninitialized: true,
  cookie: {maxAge: 1000 * 60 * 60}   /* 1 hour */
}))

//	Landing page
app.get('/', (req,res)=>{
  res.sendFile( __dirname + '/public/index.html')
})

//	Webhook to connect bot to messenger
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] && req.query['hub.verify_token'] === 'tuxedo_cat') {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.status(403).end();
  }
});

app.post('/webhook', (req, res) => {
    if(req.body.object === 'page') {
        req.body.entry.forEach((entry) => {
            entry.messaging.forEach((event) => {
      				if(event.message.attachments){
      					event.message.attachments.forEach((attachment) => {
      						handleUserLocation(attachment.payload.coordinates, event.sender.id);
      					})
				      }
              if (event.message && event.message.text) {
                  sendToAI(event);
              }
            });
        });
        res.status(200).end();
    }
});

app.post('/ai', (req, res) => {
	console.log(req.body.result.action)
	preProcessAIResponses(req, res);
});

function handleUserLocation(location, user) {
	BART.stationByLocation(location.lat, location.long, function callback(err, json){
		if(err){
			console.log(err)
		} else {
			let msg = "The closest station is " + json.name + " on " + json.address + " in "+json.city+". It is "+Math.ceil(json.distance)+" miles away";
			return sendToMessenger({text: msg}, {id: user})
		}
	})
}

function preProcessAIResponses(req, res) {
	switch (req.body.result.action) {
		case 'weather':
			getWeather(res, req);
			break;
		case 'announcements':
			getServiceAnnouncements(res);
			break;
		case 'station':
			getClosestStation(res, req.body.result.parameters.streetaddress);
			break;
		case 'allstations':
			getAllStations(res);
			break;
		case 'fromto':
			let start = req.body.result.parameters.abbr;
			let destination = req.body.result.parameters.abbr1;
			getConnectionData(res, {start: start, destination: destination});
			break;
		default:
			console.log('no processing necessary')
	}
}
function sendToMessenger(message, sender) {
	request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: process.env.FACEBOOK_TOKEN},
        method: 'POST',
        json: {
            recipient: sender,
            message: message
        }
	})
}
function handleAISuccess(response, sender){
	var aiText = response.result.fulfillment.speech;
	let id = {id: sender};
	if(aiText === 'LOCATION') {
		let button = {text: 'Please share your location', 'quick_replies': [{'content_type': 'location',}]}
		return sendToMessenger(button, id);
	}
	let message = { text: aiText}
	sendToMessenger(message, id)
}

function sendToAI(event) {
	let sender = event.sender.id;
	let text = event.message.text;
	//set set up of api.ai
	let apiai = apiaiApp.textRequest(text, {
		sessionId: 'tuxedo_cat'
	});
	apiai.on('response', (response) => {
		handleAISuccess(response, sender)
    }, function (error, response) {
        if(error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
	});
	apiai.on('error', (error) => {
		console.log(error)
	});
	apiai.end();
}


//SERVER
const server = app.listen(process.env.PORT || 5000, () => {
    console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env);
});
