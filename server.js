require('babel-register');

var express = require('express');
var path = require('path');
var logger = require('morgan');
var bodyParser = require('body-parser');
var swig  = require('swig');
var React = require('react');
var ReactDOM = require('react-dom/server');
var Router = require('react-router');
var routes = require('./app/routes');
var mongoose = require('mongoose');
var config = require('./config');
var async = require('async');
var request = require('request');
var xml2js = require('xml2js');
var spark = require('spark');
var _ = require('underscore');
var Particle = require('particle-api-js');
var jwt = require('jsonwebtoken');
var morgan = require('morgan');
var jsonfile = require('jsonfile');
const util = require('util');

var file = './tmp/prediction_results.json';

const EventEmmitter = require('events');


//mongoose models
var Light = require('./models/light');

//import methods from neuralNetwork
var predict = require('./neural_net/trained_network/neuralNetwork').predict;

//import methods from particle.js
var particleLogIn = require('./particle/Particle').logIn;
var particleGetLightLevel = require('./particle/Particle').getLightLevel;
var particleLightOn = require('./particle/Particle').lightOn;
var particleLightOff = require('./particle/Particle').lightOff;
var particleGetLightOn = require('./particle/Particle').getLightOn;

//neural network
var network_file = require('./neural_net/data/brain_network.json');

var predictionResult = {
  heading: ['Day of Week', 'Time of Day', 'Prediction'],
  values: []
};

var app = express();

// Connect to Mongo Database
mongoose.connect(config.database);

app.set('superSecret', config.secret);

mongoose.connection.on('error', function() {
  console.info('Error: Could not connect to MongoDB. Did you forget to run `mongod`?');

});

mongoose.connection.once('open', function() {
  console.info('We are connected');
})

/*
* Particle Section
*/
var token = "8949c6593b9a5f289e0c9b632270c4b29cd97cd1";
var deviceId = '53ff71066667574827382467';
var password = '';
var particle = new Particle();

function logIn() {
  particleLogIn('bonnett89@gmail.com', password , function(err, data){
    if (err) console.error('Error' + err);
    console.log('Data: ' + data.body['access_token']);
  })
}

function getLightLevel() {
  particleGetLightLevel(function(err, data){
    if (err) console.error('Error: ' + err);
    console.log('Light Level: ' + data);
    //insertLight(data);
  });
}

function lightOn(){
  particleLightOn(function(err, data){
    if (err) console.error('Error: ' + err);
    console.log('lightOn');
  });
}

function lightOff(){
  particleLightOff(function(err, data){
    if (err) console.error('Error: ' + err);
    console.log('lightOff');
  });
}

function getLightOn(){
  particleGetLightOn(function(err, data){
    if (err) console.error('Error: ' + err);
    //console.log('Light On: ' + data);
    return data;
  });
}

function insertLight(lightLevel, lightState, date) {
  var light = new Light({
    lightLevel: lightLevel,
    date: date,
    lightState: lightState
  });
  console.log(light);
  light.save(function(err, light) {
    if(err) return console.error(err);
    console.log('Light reading saved!')
  });
}

/*
function logLightLevel() {
  particle.getVariable({ deviceId: deviceId, name: 'lightReading', auth: token }, 200).then(function(data) {
          //console.log('Device variable retrieved successfully:', data);
          var insertLight = function() {
          var light = new Light({
            value: data.body['result'],
            date: new Date(Date.now())
          });
          //console.log(light._id);
          light.save(function(err, light) {
            if(err) return console.error(err);
            console.log('Light reading saved!')
          });
        }
        insertLight();
        callback(null);
        }, function(err) {
        console.log('An error occurred while getting attrs:', err);
        callback();
        });
}
*/

function logLightData() {

  particleGetLightLevel(function(err, data){
    if (err) console.error('Error: ' + err);
    getLightState(data);
  });

  function getLightState(lightLevel) {
    particleGetLightOn(function(err, data){
      if (err) console.error('Error: ' + err);
      createDate(lightLevel, data);
    })
  }

  function createDate(lightLevel, lightState) {
    var date = new Date(Date.now());
    insertLight(lightLevel, lightState, date);
  }
}

function getLightLevel (callback) {
  var particle = new Particle();
  particle.getVariable({ deviceId: deviceId, name: 'lightReading', auth: token }).then(
    function(data){
      var value = data.body['result'];
      callback(null, value);
    }, 
    function(err) {
        console.log('An error occurred while getting attrs:', err);
        callback(err);
    }
  );
}

//setInterval(logLightData, 5000);

function learningMode() {
  var particle = new Particle();
  var network = network_file;
  
  particleGetLightLevel(function(err, data){
    if (err) console.error('Error: ' + err);
    getDate(data);
  });
      
  function getDate(l) {
    var lightLevel = l / 10000;
    //console.log(lightLevel);
    var d = new Date(Date.now())
    //console.log(d);

    var dayOfWeek = d.getDay() / 10;
    //GET TIME OF DAY
    var hour = addZero(d.getHours()).toString();
    var minutes = addZero(d.getMinutes()).toString();
    var seconds = addZero(d.getSeconds()).toString();

    var timeCombined = '0.'+ hour + minutes + seconds;

    var time = parseFloat(timeCombined);

    getPrediction(lightLevel, dayOfWeek, time);
  }

  function addZero(i) {
    if(i < 10) {
    i = '0' + i;
    }
    return i;
  }

  function getPrediction(l,d,t) {
        
    //{ light: 0.02, day: 0.4, time: 0.114530 }
    var result = predict({ light: l, day: d, time: t}, network);

    //console.log('OFF: ' + result['off']);
    //console.log('ON: ' + result['on']);

    particleGetLightOn(function(err, data){
      console.log(predictionResult);
      if (result['on'] > 0.5) {
        var predValue = 'ON';
      } else {
        var predValue = 'OFF';   
      }
      //var currentPred = [d, t, predValue];
      //console.log(currentPred);
      //predictionResult['values'].push(currentPred);
      //console.log(predictionResult);

      if (err) console.error('Error: ' + err);
      if (result['on'] > 0.5 && data == 0) {
        lightOn();
      }
      if (result['off'] > 0.5 && data == 1) {
        lightOff();
      } 
    });
  }
}

function saveToJSON(contents) {
  //console.log(contents);
  jsonfile.writeFile(file, contents, function (err) {
    console.error('Error: ' + err);
  });
}

var apiRoutes = express.Router();

app.set('port', process.env.PORT || 3000);
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

/*
* GET /api/lightinglevels
* retrieve lighting levels from mongo
*/
app.get('/api/lightlevels', function(req, res, next){
  //console.log("API CALL MADE");
  var params = req.query;
  var conditions = {};

  _.each(params, function(value, key) {
    conditions[key] = new RegExp('^' + value + '$', 'i');
  });

  Light
    .find(conditions)
    .sort({date: 'descending'})
    .limit(100)
    .exec(function(err, lights){
      if (err) return next(err);
      res.send(lights);
    });
});

/*
* POST /api/lightingMode
* change the lighting mode of the system
*/
var intervalId;

app.post('/api/lightingmode', function(req, res, next) {
  var mode = req.body.mode;
  //console.log(req.body.mode);
  console.log('Mode: ' + mode);
  try {
    if (mode == 'learning') {
      intervalId = setInterval(learningMode, 10000);
      res.send( { message: mode + ' has been activated!'});
    } else {
      clearInterval(intervalId);
      //saveToJSON(predictionResult);
      res.send( { message: 'manual mode has been activated!'});
    }
  } catch (e) {
    return res.status(400).send({ message: 'Lighting Mode Error'});
  }
});

app.use('/api', apiRoutes);
/*
* POST /api/lightstate
* change the light state of a light
*/
app.post('/api/lightstate', function(req, res, next) {
  var lightState = req.body.lightState;
  console.log(req.body.lightState);
  //console.log('Mode: ' + mode);
  try {
    if (lightState == 'on') {
      particleLightOn();
      res.send( { message: 'Light has been set to ' + lightState });
    } else {
      particleLightOff();
      res.send( { message: 'Light has been set to ' + lightState });
    }
  } catch (e) {
    return res.status(400).send({ message: 'Lighting State Error'});
  }
});

app.post('/api/loggingState', function(req, res, next){
  var logging = req.body.logState;
  //var interval = req.body.interval;
  console.log('Log State: ' + logging);
  try {
    if (logging == 'log') {
      intervalId = setInterval(logLightData, 60000);
      res.send( { message: 'light data now logging' });
    } else {
      //console.log('Turning off: ' + intervalId)
      clearInterval(intervalId);
      res.send( { message: 'no longer logging' });
    }
  } catch (e) {
    console.log('Catch error: ' + e)
    return res.status(400).send({ message: 'Logging error' });
  }
});

app.use(function(req, res) {
  Router.match({ routes: routes.default, location: req.url }, function(err, redirectLocation, renderProps) {
    if (err) {
      res.status(500).send(err.message)
    } else if (redirectLocation) {
      res.status(302).redirect(redirectLocation.pathname + redirectLocation.search)
    } else if (renderProps) {
      var html = ReactDOM.renderToString(React.createElement(Router.RoutingContext, renderProps));
      var page = swig.renderFile('views/index.html', { html: html });
      res.status(200).send(page);
    } else {
      res.status(404).send('Page Not Found')
    }
  });
});

app.listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});
