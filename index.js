var express = require('express');
var webshot = require('webshot');
var fs      = require('fs');
var temp    = require("temp");
var http = require("http");
var https = require("https");
var request = require('request');


var app = express();

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));
//  /^\/(.+)/
app.get("/repos/(*)", function(req, res) {
    console.log('WB')
    
    var r = {'user': req.query.user, 'repo': req.query.repo, 'branch': req.query.branch, 'jobNr': req.query.jobNr, 'envContains': req.query.envContains };
    console.log('request: ' + JSON.stringify(r));

    if (!r.repo) {
	res.status(400);
	res.send('Username not provided (query string param: "user")');
    }

    if (!r.repo) {
	res.status(400);
	res.send('Repository not provided (query string param: "repo")');
    }
    
    r.repoBranch = r.user + '/' + r.repo + (r.branch ? ('/' + r.branch) : '');
    
    var html = "<br/><table><tr><th>Builds</th></tr>";
    var options = {
	url: "https://api.travis-ci.org/repos/" + r.repoBranch,
	headers: {
            'Accept': 'application/vnd.travis-ci.2+json'
	}
    };
    console.log("url: " + options.url)
    request(options, function (error, response, body) {
	console.log('[' + response.statusCode + '] ' + error + ' ' + body); 
	if (error || response.statusCode != 200) {
	    res.status(400);
	    res.send('Repository or branch not found: ' + r.repoBranch);
	}
	
	
	var buildId = JSON.parse(body).branch.id;
	if (!buildId){
	    res.status(400);
	    res.send('Within repository ' + r.repoBranch + ' no Travis build was found');
	}
	
	var options2 = {
	    url: "https://api.travis-ci.org/builds/" + buildId,
	    headers: {
		'Accept': 'application/vnd.travis-ci.2+json'
	    }
	};
		
	request(options2, function (error2, response2, body2) {
	    console.log('[' + response2.statusCode + '] ' + error2 + ' ' + body2); 
	    if (error2 || response2.statusCode != 200) {
		res.status(400);
		res.send('Within repository ' + r.repoBranch +
			 ' could not retrieve build details for buildId ' + buildId);
	    } else {
		var jobs = JSON.parse(body2).jobs;
		if (!jobs){
		    res.status(400);
		    res.send('Within repository ' + r.repoBranch +
			     ' the build ' + buildIdNo + ' has no jobs');
		}

		jobs.forEach(function (job) {
		    var state = job.state;
		    var number = job.number;
		    var dot = number.indexOf(".");
		    var shortNumber = (dot >= 0) ? number.slice(dot + 1) : number;
		    
		    if (r.jobNr && (r.jobNr != shortNumber)) {
			return;
		    }
		    if (r.envContains && (job.config.env.indexOf(r.envContains) == -1)) {
			return;
		    }
		    
		    if (r.jobNr || r.envContains) {
			console.log('Found matching job #' + job.number + ' (' + state + ') with jobNr=' + shortNumber + ' and env=' + job.config.env);
			redirectToShieldsIo(state, res);
		    } else {
			html += "<tr><td>" + number + "</td>"
			html += "<td>" + job.config.env + "</td>"
			// html += " " + JSON.stringify(job.config)
			html += "<td>"
			if (state == "passed"){
			    html += "<span style='color:green;'>passed</span>";
			} else if (state == "failed"){
			    html += "<span style='color:red;'>failed</span>";
			} else {
			    html += state;
			}
			html += "</td></tr>";
		    }
		});
		
		if (r.jobNr) {
		    res.status(400);
		    res.send('jobNr ' + r.jobNr + ' not found, within buildId: ' + buildId);
		}
		if (r.envContains) {
		    res.status(400);
		    res.send('No job has "' + r.envContains + '" in its env, within buildId: ' + buildId);
		}
	    }
	    html += "</table>";
	    html += "<br/>Build ID: " + buildId;
	    screenShot(html, function(original, cleanupScreenShot){
		writeFileToResponse(original, res, function(){
		    cleanupScreenShot();
		});
	    });
	});
    });
});
  
app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'));
});

function createTempPng(){
  return temp.path({suffix: '.png'});
}

function writeFileToResponse(file, resp, callback){
  resp.writeHead(200, { 'Content-Type': 'image/png' });
  fs.readFile(file, function(err, data){
    resp.end(data);
    callback();
  });
}

function cleanupTempFile(file){
  fs.unlink(file, function(err){
    if(err) console.error(err);
  });  
}

function screenShot(html, callback){
  var original = createTempPng();
  var options = {
    shotSize: {
      width: 'all'
    , height: 'all' 
    }
    , siteType:'html'
  }
  webshot(html, original, options, function(err){
    callback(original, function(){
      cleanupTempFile(original);
    });
  });
}

function redirectToShieldsIo(state, res) {
  if (state == "passed") {
    redirect("https://img.shields.io/badge/build-passing-brightgreen.svg", state, res)
  }
  else if (state == "failed") {
    redirect("https://img.shields.io/badge/build-failure-red.svg", state, res);
  }
  else {
    var url = "https://img.shields.io/badge/build-" + state + "-yellow.svg";
    redirect(url, state, res);
  }
}

function redirect(url, state, res) {
  request.get(url, function(err, response, body) {
    if (err) {
      res.status(500).send(err);
      return;
    }
    res.header("Cache-Control", "no-cache, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "Thu, 01 Jan 1970 00:00:00 GMT");
    res.header("ETag", state);
    res.header("content-type", "image/svg+xml;charset=utf-8");
    res.status(response.statusCode).send(body);
  });
}

