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

app.get("/badge(*)", function(req, res) {
    var r = {'user': req.query.user,
	     'repo': req.query.repo,
	     'branch': (req.query.branch || 'master'),

	     'jobNr': req.query.jobNr,
	     'envContains': req.query.envContains,
	     
	     'ifNoneMatch': req.get('If-None-Match')
	    };
    
    console.log('request /badge ' + JSON.stringify(r));
    withBuild(r, res, function(branchBuild, jobs, etagValue) {
	
	var foundMatches = [];
	jobs.forEach(function (job) {
	    var number = job.number;
	    var dot = number.indexOf(".");
	    var shortNumber = (dot >= 0) ? number.slice(dot + 1) : number;
	    
	    if (r.jobNr && (r.jobNr != shortNumber)) {
		console.log('Job ' + job.id + ' has shortNumber=' + shortNumber + ' != r.jobNr=' + r.jobNr); 
		return;
	    }
	    if (r.envContains && (job.config.env.indexOf(r.envContains) == -1)) {
		return;
	    }

	    if (r.jobNr || r.envContains) {
		console.log('Found matching job #' + job.number + ' (' + job.state + ') with jobNr=' + shortNumber + ' and env=' + job.config.env);
		foundMatches.push({'jobNumber': job.number, 'jobEnv': job.config.env, 'jobState': job.state});
	    }
	});

	if (foundMatches.length > 1) {
	    res.status(400);
	    res.send('Ambiguous filter params: multiple matching jobs within buildId=' + branchBuild.buildId + ': ' + JSON.stringify(foundMatches));
	    return;
	} else if (foundMatches.length == 0) {
	    res.status(400);
	    res.send('Too strict filter params: no matching jobs within buildId=' + branchBuild.buildId + '.');
	    return;
	} else {
	    redirectToShieldsIo(foundMatches[0].jobState, res, etagValue);
	}
    });
});
    
app.get("/table(*)", function(req, res) {
    var r = {'user': req.query.user,
	     'repo': req.query.repo,
	     'branch': (req.query.branch || 'master'),
	     'ifNoneMatch': req.get('If-None-Match')
	    };
    
    console.log('request /table ' + JSON.stringify(r));
    withBuild(r, res, function(branchBuild, jobs, etagValue) {
	
	var html = '<table id="myTable"><tr><th colspan="3">Last build: ' + branchBuild.finished_at.replace('T', ' ').replace('Z', ' ') + '</th></tr>';
	jobs.forEach(function (job) {
	    
	    var number = job.number;
	    var dot = number.indexOf(".");
	    var shortNumber = (dot >= 0) ? number.slice(dot + 1) : number;
	    
	    
	    // html += "<tr><td>" + number + "</td>"
	    html += "<td>" + (((jobs.length > 1) && job.config.env) ? job.config.env : '') + "</td>"
	    // html += " " + JSON.stringify(job.config)
	    html += "<td>"
	    if (job.state == "passed"){
		html += "<span style='color:green;'>passed</span>";
	    } else if (job.state == "failed"){
		html += "<span style='color:red;'>failed</span>";
	    } else if (job.state == "cancelled"){
		html += "<span style='color:salmon;'>cancelled</span>";
	    } else {
		html += job.state;
	    }
	    html += "</td></tr>";
	});

	html += "</table>";
	    
	screenShot(html, function (original, cleanupScreenShot) {
	    writeFileToResponse(original, res, etagValue, function(){
		cleanupScreenShot();
	    });
	});
    });
});

function withBuild(r, res, buildIdJobsCallback) {
    if (!r.user) {
	res.status(400);
	res.send('Username not provided (query string param: "user")');
	return;
    }
    if (!r.repo) {
	res.status(400);
	res.send('Repository not provided (query string param: "repo")');
	return;
    }
    r.repoBranch = r.user + '/' + r.repo;
    if (r.branch) {
	r.repoBranch += '/branches/' + r.branch;
    }

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
	    res.send('User, repository or branch not found: ' + r.repoBranch);
	    return;
	}

	var branchBuild = JSON.parse(body).branch;
	var buildId = branchBuild.id;
	if (!buildId){
	    res.status(400);
	    res.send('Within repository ' + r.repoBranch + ' no Travis build was found');
	    return;
	}

	var etagValue = branchBuild.finished_at;
	if (r.ifNoneMatch) {
	    console.log('Receive ETag from browser: ' + r.ifNoneMatch);
	    if (r.ifNoneMatch == etagValue) {
		console.log('Etag the same -> return 304: ' + etagValue);
		res.status(304);
		res.send('');
		return;
	    } else {
		console.log('Browser and local etag mismatch -> calulate response');
	    }
	} else {
	    console.log('Local ETag: ' + etagValue);
	}
	    
	var options2 = {
	    url: "https://api.travis-ci.org/builds/" + buildId,
	    headers: {
		'Accept': 'application/vnd.travis-ci.2+json'
	    }
	};

	console.log('url 2: ' + options2.url);
	request(options2, function (error2, response2, body2) {
	    
	    console.log('[' + response2.statusCode + '] ' + error2); 
	    if (error2 || response2.statusCode != 200) {
		res.status(400);
		res.send('Within repository ' + r.repoBranch + ' could not retrieve build details for buildId ' + buildId);
		return;
	    } else {
		var jobs = JSON.parse(body2).jobs;
		if (!jobs){
		    res.status(400);
		    res.send('Within repository ' + r.repoBranch + ' the build ' + buildIdNo + ' has no jobs');
		    return;
		}

		buildIdJobsCallback(branchBuild, jobs, etagValue);
	    }
	});
    });
};

app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'));
});

function createTempPng(){
  return temp.path({suffix: '.png'});
}

function writeFileToResponse(file, resp, etagValue, callback){
    resp.writeHead(200, { 'Content-Type': 'image/png', 'ETag': etagValue });
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
	width: '300',
	height: '1000',
	captureSelector: '#myTable'
    }
    , siteType:'html'
  }
    webshot(html, original, options, function(err){
	console.log("webShot: err=" + err);
	callback(original, function(){
	    cleanupTempFile(original);
	});
    });
}

function redirectToShieldsIo(state, res, etagValue) {
  if (state == "passed") {
      redirect("https://img.shields.io/badge/build-passing-brightgreen.svg", state, res, etagValue)
  } else if (state == "failed") {
      redirect("https://img.shields.io/badge/build-failure-red.svg", state, res, etagValue);
  } else {
    var url = "https://img.shields.io/badge/build-" + state + "-yellow.svg";
      redirect(url, state, res, etagValue);
  }
}

function redirect(url, state, res, etagValue) {
    console.log("redirect: " + url);
    request.get(url, function(err, response, body) {
	console.log("Response: " + response.statusCode);
	if (err) {
	    console.log("Request failed: " + err + " for: " + url);
	    res.status(500).send(err);
	} else {
	    //res.header("Cache-Control", "no-cache, must-revalidate");
	    //res.header("Pragma", "no-cache");
	    //res.header("Expires", "Thu, 01 Jan 1970 00:00:00 GMT");
	    //res.header("ETag", state);
	    res.header("content-type", "image/svg+xml;charset=utf-8");
	    res.header("ETag", etagValue);
	    res.status(response.statusCode).send(body);
	}
    });
}

