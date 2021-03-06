/*jshint esversion: 8 */

var siteState;
var siteStateCheck = Date.now()-10000;

//load the additional script collections for the server
var twitterApiExt = require('./twitApiExt.js');
var utilities = require('./utilityFunctions.js')

//load all required packages
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var bodyParser = require('body-parser');
var indexRouter = require('./routes/index');
var exampleRouter = require('./routes/exampleIndex');
var mongoose = require('mongoose');
var request = require('request');
var nodeHTMLParser = require('node-html-parser');
var yaml = require('js-yaml');
var fs = require('fs')

const https = require('https');
const turf = require('@turf/turf');

var app = express();

var configurations = {};


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');


// parse application/x-www-form-urlencoded
// devnote: changed from false to true, blame FELIX if it broke anything.
app.use(bodyParser.urlencoded({ extended: true }));

// parse application/json
app.use(bodyParser.json());

// mongoose setup
mongoose.connect('mongodb://localhost:27017/geomergency', {useNewUrlParser: true, useUnifiedTopology: true}, function(err){
  if (err) {
    console.log("mongoDB connect failed");
    console.log(err);
  }
  console.log("mongoDB connect succeeded");
  console.log(mongoose.connection.host);
  console.log(mongoose.connection.port);
});


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// sets paths to routers
app.use('/', indexRouter);
app.use('/geomergency', indexRouter);
app.use('/geomergency/:coords', indexRouter);

app.use('/example', exampleRouter);
app.use('/example/:coords', exampleRouter);

//loop that checks the site status in the status-api each seconds
setInterval(
async function(){
  var statuses = await queryStatuses({
    messageType:"siteState",
    created_at: { $gt: siteStateCheck}
  })

  //if the state has changed, update it
  if(statuses.length > 0){
    if(statuses[statuses.length -1].message != siteState){
      siteState = statuses[statuses.length -1].message;
      console.log("set new siteState: "+siteState);

      //remove the siteStates after checking
      rmStatuses({
        messageType: "siteState"
        // visible: visible
      });

      updateTweetStream(configurations.tweetParams,
        function(tweet){
          if(tweet.coordinates != null){
          // call getEmbeddedTweet() -> postTweetToMongo()
          getEmbeddedTweet(tweet);
        }
      },
      siteState);
    }
    //set the timestamp of last check to current time - one sec
    siteStateCheck = Date.now()-1000;
  }
},
2000
);

//initialise tweet stream
// updateTweetStream(configurations.tweetParams,
//   function(tweet){
//     if(tweet.coordinates != null){
//     // call getEmbeddedTweet() -> postTweetToMongo()
//     getEmbeddedTweet(tweet);
//   }
// },
// "geomergency");

/**
* @function geomergencyRouter
* sets the server internal siteState and returns the router.
* @returns indexRouter as defined in app.js
*/
function geomergencyRouter(){
  siteState = "geomergency";

  console.log("attempting stream init!!!")
  updateTweetStream(
    configurations.tweetParams,
    function(tweet){
      console.log(tweet.id_str)
      if(tweet.coordinates != null){
      // call getEmbeddedTweet() -> postTweetToMongo()
      getEmbeddedTweet(tweet);
    }},
    "geomergency"
  );

  return indexRouter;
}

/**
* @function exampleScenarioRouter
* sets the server internal siteState and returns the router.
* @returns exampleRouter as defined in app.js
*/
function exampleScenarioRouter(){
  siteState = "example";

  updateTweetStream(
    configurations.tweetParams,
    function(tweet){
      return true
    },
    "example"
  );

  //return the router
  return exampleRouter;
}

/**
* @function updateTweetStream
* @desc initialises the tweet stream with given parameters and current Site-state
* @param params the params of the stream
* @param callback callback function, what to do with the returned tweets. only works when page in standard mode
* @param siteState String that indicates whether or not the site is currently in demo-scenario mode or standard mode
*/
async function updateTweetStream(params, callback, siteState){
  //kill the running stream when called
  twitterApiExt.killStreamExt();
  //initialise a new one

  twitterApiExt.tweetStreamExt(params, callback, siteState);
}


app.use("/leaflet", express.static(__dirname + "/node_modules/leaflet/dist"));
app.use("/leafletdraw", express.static(__dirname + '/node_modules/leaflet-draw/dist'));
app.use('/jquery', express.static(__dirname + '/node_modules/jquery/dist'));
app.use('/bootstrap', express.static(__dirname + '/node_modules/bootstrap/dist'));
app.use('/popper.js', express.static(__dirname + '/node_modules/popper.js/dist'))
app.use('/turf', express.static(__dirname + '/node_modules/@turf/turf'))

// use scripts, styles in webserver
app.use("/stylesheetpug", express.static(__dirname + '/public/stylesheets/style.css'));
app.use("/leafletscript", express.static(__dirname + '/public/javascripts/leaflet.js'));
app.use("/siteScripts", express.static(__dirname+'/public/javascripts/siteScripts.js'));


app.use('/gemeinden', express.static(__dirname + '/public/jsons/landkreiseSimp.json'));

// mongoDB models:
var Kreis = require("./models/kreis");
var UnwetterKreis = require("./models/unwetterkreis");
const Status = require("./models/status.js");
const Tweet = require('./models/tweet.js');

var weatherRouter = require("./routes/badweather");
app.use('/weather', weatherRouter);

var rRouter = require("./routes/r");
app.use('/r', rRouter);

var radarRouter = require("./routes/radar");
app.use('/radar', radarRouter);

var summaryRouter = require("./routes/summary");

app.use('/summary', summaryRouter);

/**
* @function queryTweets
* @param queries, Object of mongoose queries
* @return mongoose docs
*/
async function queryTweets(queries){
  let output = await Tweet.find(
    queries,
    {__v:0, _id:0},
    function(err,docs){
      if(err){
        console.log("~~~~~! error in mongoDB query !~~~~~");
        console.log(error);
        throw error;
      } else {
      return docs;
      }
    }
  );
  return output
}



//set the configutrations
configurations = utilities.loadConfigs(__dirname+'/config.yml');

////////////////////////////////////////////////////////////////////////////////
//Tweet api
////////////////////////////////////////////////////////////////////////////////

//~~~~~~~API-endpoints~~~~~~~
//public DB search API
app.get('/tweets', async (req, res) => {
  res.send(await tweetSearch(req, res));
});

app.delete('/tweets', async (req, res) => {
  await tweetDelete(req,res)
});

/**
* @function tweetDelete middleware function
* @desc function that is being called when a delete tweet call is made to the tweets endpoint
* param: id_str the id of the tweet(s) to delete
*/
async function tweetDelete(req,res){
  if(!req.query.id_str){
    await Tweet.deleteMany(
      {},
      function(err){
        if(err){
          output = false;
        } else {
          output = true;
        }
      }
    );
    return true
  }

  //get the id params
  let ids = req.query.id_str;
  ids = ids.split(",");

  //delete each id
  for(let id of ids){
    console.log({
      'id_str': id
    })
    await Tweet.remove({
      'id_str': id
    }, function(error){
      if(error){
        res.status(500)
        res.send(`error in deleting tweet ${id}: ${error}`)
      }
    });
  }

  res.status(200)
  res.send(`tweets deleted from cache`)
}

/**
* @function tweetSearch middleware function
* @desc callback function that looks at the arguments passed in the tweet API request and returns the according response.
* example http://localhost:3000/tweets?fields=id,text
* params: bbox: The bounding Box of the geographical area to fetch tweets from
*         include: The strings that are to be included in the returned tweets
*         exclude: The strings that aren't to be included in the returned tweets
*         fields: The fields of the tweets that are to be returned
*         latest: whether or not to only show the latest tweet
* @param req
* @param res
*/
async function tweetSearch(req,res){
  let outJSON = {tweets : []};
  let newOutJSON = {tweets : []};
  const geoJSONtemplate = {"type": "FeatureCollection","features": [{"type": "Feature","properties": {},"geometry": {"type": "","coordinates": [[]]}}]};

  //access the provided parameters
  var older_than = req.query.older_than;
  var bbox = req.query.bbox;
  var include = req.query.include;
  var exclude = req.query.exclude;
  var fields = req.query.fields;
  var latest = req.query.latest;

  //array-ize include and exclude
  if(include != undefined){
    include = include.split(",")
  }
  if(exclude!=undefined){
    exclude = exclude.split(",")
  }

  //check validity of parameters
  if (bbox == undefined){
    res.status(400),
    res.send("bbox is not defined")
  }

  //QUERY BoundingBox
  //create boundingBox geojson from given parameters
  try {
    bbox = bbox.split(",");
  }catch(err){
    //check
    res.status(400)
    res.send("error in bbox parameter<hr>"+err)
  }

  //numberify the strings
  for(let i = 0; i < bbox.length; i++){
    bbox[i] = parseFloat(bbox[i]);

    //return error when bbox coord was not given a number
    if(isNaN(bbox[i])){
      res.status(400);
      res.send("bbox parameter "+i+" is not a number <hr>");
    }
  }

  //check validity of bbox
  if(bbox.length != 4){
    res.status(400)
    res.send("invalid parameter for bbox")
  }
  //check validity of bbox coordinates
  if(!(
    (bbox[0]>bbox[2])&& //north to be more north than south
    (bbox[1]<bbox[3])&& //west to be less east than east

    bbox[0]<=85 && bbox[0]>=-85&& //north and south in range of 85 to -85 degrees
    bbox[2]<=85 && bbox[2]>=-85&&

    bbox[1]<=180 && bbox[1]>=-180&& //east and west in range of 180 to -180 degrees
    bbox[3]<=180 && bbox[3]>=-180
  )){
    res.status(400)
    res.send("bbox coordinates are not geographically valid")
  };

  //use the filters on the data
  try{
    //QUERY older_than
    //if no or incorrect time data is given, set to unix timestamp 0
    if (older_than == undefined || isNaN(older_than)){
      older_than = 0;
    }

    //call to function that will look for tweets on TweetDB within bounding box.
    //outJSON.tweets = await getTweetsInRect(bbox)
    outJSON.tweets = await queryTweets({
      'geojson.geometry.coordinates': {
        $geoWithin: {
          $box : [
            [bbox[1],bbox[2]], //West-Sount
            [bbox[3],bbox[0]] //East-North
          ]
        }
      },
      created_at: {$gt: older_than}
    });


    //QUERY include
    if(include != undefined){
      //loop through each substring that has to be included
      for(let i = 0; i < include.length; i++){
        //check for substrings existence in each tweet
        for(let tweet of outJSON.tweets){
          if(
            tweet.text.includes(include[i])
            // ||
            // tweet.text.toLowerCase().includes(include[i].toLowerCase())
          ){
            //lastly, make sure the tweet hasn't already been matched by previous substrings to prevent duplicates
            /**
            * @function containsPreviousSubstring
            * @desc helping function that checks whether a previous substring is contained within the examined tweet
            * only works within tweetSearch.
            * @see tweetSearch
            * @returns boolean
            */
            let containsPreviousSubstring = function(){
              for(let j=0;j<i;j++){
                if(
                  tweet.text.includes(include[j])
                  // ||
                  // tweet.text.toLowerCase().includes(include[j].toLowerCase())
                ){
                return true;}
                else {
                  return false;
                }
              }
            };
            //still making sure the tweet hasn't been matched with previous substrings...
            if(i==0){newOutJSON.tweets.push(tweet);
            }else if(!containsPreviousSubstring()){
              newOutJSON.tweets.push(tweet);
            }
          }
        }
      }
      //make newOutJSON the new outJSON, reset the former
      outJSON = newOutJSON;
      newOutJSON = {"tweets":[]};
    }

    //QUERY exclude
    if(exclude != undefined && outJSON.tweets != undefined){
      //loop through each substring and make sure they're in none of the tweets
      for(let substring of exclude){
        //    exclude = exclude.match(/(["'])(?:(?=(\\?))\2.)*?\1/g);
        for(let i= outJSON.tweets.length-1; i >= 0; i--){
          //console.log(outJSON.tweets[i].text)
          if(
            outJSON.tweets[i].text.includes(substring)
            // ||
            // tweet.text.toLowerCase().includes(include[j].toLowerCase())
          ){
              outJSON.tweets.splice(i,1);
            }
        }
      }
    }

    //QUERY latest
    //if latest is requested, return only latest tweet meeting given parameters
    if(latest != undefined){
      if(latest.toUpperCase() === "TRUE"){
        //in the beginning was Jan 01 1970
        let latestTime = new Date("Thu Jan 01 00:00:00 +0000 1970");


        for(let tweet of outJSON.tweets){
          //if there is a younger one than the previous, make that the new latest
          if(new Date(tweet.created_at) > latestTime){
            latestTime = tweet.created_at;
            newOutJSON.tweets = [];
            newOutJSON.tweets.push(tweet);
          }
        }
        //make newOutJSON the new outJSON, reset the former
        outJSON = newOutJSON;
        newOutJSON = {"tweets":[]};
      }
    }

    //QUERY fields
    //if field params are passed, return requested fields only
    if(fields != undefined){
      fields = fields.split(",");

      //check if requested fields exist
      for (let field of fields){
        if(!(
        field == "geojson" ||
        field == "_id" ||
        field == "id_str" ||
        field == "text" ||
        field == "created_at"
        )){
          res.status(400)
          res.send("requested field "+field+" does not exist")
        }
      }

      let fieldtweets = {"tweets" : []};
      //traverse every tweet in the given list
      for (let entry of outJSON.tweets){
        //for every tweet, pick only the fields that are specified
        let tweet = {};
        for (let field of fields){
          tweet[field] = entry[field];
        }
        fieldtweets.tweets.push(tweet);
      }
      outJSON = fieldtweets;
    }
  }catch(error){
    res.status(500)
    res.send(`filter of tweet data failed <br> ${error}`)
  }

  return outJSON;
}

module.exports = app;

/**
* @function postTweetToMongo
* @param tweet the tweet object
* @param includes array containing strings that have to be contained in tweets
* @param excludes array containing strings that mustn't be in tweets
*/
function postTweetToMongo(tweet){
  console.log(`posting ${tweet.text}`)
  //initialise embeddedTweet as false
  var embeddedTweet = false;

  //get the plain text of the tweet
  //it needs to be parsed from the html because twitter API doesn't always return full text
  var plaintext = nodeHTMLParser.parse(tweet.embeddedTweet);
  plaintext = plaintext.firstChild.text;

  Tweet.create({
    id_str : tweet.id_str,
    text : plaintext,
    created_at : Date.parse(tweet.created_at),
    embeddedTweet : tweet.embeddedTweet,
    geojson: {
      type: "Feature",
      properties: {
      },
      geometry: {
        type : "Point",
        coordinates : [tweet.coordinates.coordinates[0], tweet.coordinates.coordinates[1]]
      }
    }
  },
  function(err, tweet){
    if(err){
      console.log("error in saving tweet to DB");
      console.log(err);
      return false;
    }
  });

  //indicate status
  utilities.indicateStatus(`fetched tweet: ${tweet.id_str}`);
}

/**
* @function getEmbeddedTweet
* @desc sends a request to the twitter Oembed API to get an embedded tweet https://developer.twitter.com/en/docs/tweets/post-and-engage/api-reference/get-statuses-oembed
* then calls postTweetToMongo in order to add the tweet to the database
* @param tweet the tweet-object
*/
async function getEmbeddedTweet(tweet){
  var output;
  var requestURL = "http://publish.twitter.com/oembed?url=https://twitter.com/t/status/";
  //let requestURL = "https://localhost:3000/embedTweet?id="
  requestURL = requestURL.concat(tweet.id_str);

  var requestSettings = {
    uri: requestURL,
    method: 'GET',
    encoding: null,
  };
  await request(requestSettings, function(error, response, body){
    if(error){console.log(error);}
    	else{
      tweet.embeddedTweet = JSON.parse(body).html;
      postTweetToMongo(tweet);
    }
  });
}

////////////////////////////////////////////////////////////////////////////////
//status-indication api
////////////////////////////////////////////////////////////////////////////////
//endpoints
app.get('/statuses', async (req,res)=> {
  res.send(await getProcesses(req, res));
});
app.post('/statuses', async (req,res)=> {
  postProcesses(req, res);
});

//functions
/**
* @function getProcesses middleware function for getting Processes
* @desc middleware function that looks for running processes
* @param req
* @param res
*/
async function getProcesses(req,res){
  let outJSON = {messages: []};

  //access provided parameters
  var older_than = req.query.older_than;
  var remove = req.query.remove;
  var messageType = req.query.messageType;
  // var visible = req.query.visible;

  //if param empty, assign default values
  if(remove == undefined){
    remove = true;
  }
  if(older_than == undefined || older_than == ""){
    older_than = 0;
  }
  if(!(messageType == undefined || messageType == "")){
    messageType = messageType;
  } else {messageType = "processIndication"}


  //check validity of parameters and convert them from strings
  try{
    if(!(older_than == undefined || older_than == "")){
      older_than = parseInt(older_than);
    }
    if(typeof remove != "boolean"){
      if(remove.toLowerCase() == "true" || remove.toLowerCase() == "false"){
        remove = (remove.toLowerCase() == "true");
      }
    }
  }catch(err){
    res.status(400);
    res.send(`invalid parameters older_than: ${older_than}, remove: ${remove}`);
  }

  //get the Status messages
  outJSON.messages = await queryStatuses({
    created_at: {$gt: older_than},
    messageType: messageType
  }, res);

  //remove the status messages from DB if specified
  if(remove){
    rmStatuses({
      created_at: {$gt: older_than},
      messageType: messageType
      // visible: visible
    });
  }

  //return the status messages
  return outJSON.messages;
}

/**
* @function queryStatuses
* @desc function that queries the mongo status collection
* @param queries, Object of mongoose queries
* @param res, express response for error handling
* @return mongoose docs
*/
async function queryStatuses(queries, res){
  let output;
  //look for statuses with the given parameters
  output = await Status.find(
    queries,

    //exclude visible, messageType, __V and _id
    {
      __v:0,
      _id:0,
      messageType:0
    }
  );

  return output;
}

/**
* @function rmStatuses
* @desc function that removes messages from the mongo status collection
* @param queries, Object of mongoose queries
* @param res, express response for error handling
* @return true or false
*/
async function rmStatuses(queries){
  let output = false;
  await Status.deleteMany(
    queries,
    function(err){
      if(err){
        output = false;
      } else {
        output = true;
      }
    }
  );
  return output;
}

/**
* @function postProcesses middleware function for posting Processes
* @desc middleware function that takes the attributes in a function body (x-www-form-urlencoded)
* @param req
* @param res
*/
async function postProcesses(req,res){
  var created_at = req.body.created_at;
  var message = req.body.message;
  var messageType;

  if(req.body.messageType != undefined){
    messageType = req.body.messageType;
  } else {messageType = "processIndication"}

  //check if all attributes are there
  if(message == undefined || message == "" || created_at == undefined || created_at == ""){
    res.status(400);
    res.send(`invalid attributes: created_at: ${created_at}, message: ${message}`);
  } else {
    //add the status to the designated Mongo collection
    Status.create({
      created_at : created_at,
      message : message,
      // visible : visible,
      messageType : messageType
    },
    function(err, tweet){
      if(err){
        // res.status(400).send("error in posting status: ", err);
      }
    });

    //if it went well, tell them
    res.status(200).send(`Status successfully posted`);
  }
}
