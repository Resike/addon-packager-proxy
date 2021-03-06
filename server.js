var bl = require('bl'),
	crypto = require('crypto'),
	express = require('express'),
	request = require('request');

var app = express(),
	projects = {},
	workID = 0;

var Log = new require('./utils').Log(),
	Strings = require('./utils').Strings,
	Packager = require('./packager');

app.listen(process.env.PORT || 5000);

app.get('/', function(req, res){
	res.redirect('https://github.com/p3lim/addon-packager-proxy/wiki/Setup');
});

app.param(function(name, fn){
	if(fn instanceof RegExp){
		return function(req, res, next, val){
			var captures;
			if(captures = fn.exec(String(val))){
				req.params[name] = captures;
				next();
			} else
				next('route');
		}
	}
});

app.param('repo', /[\d\w\.-]+/);
app.param('tag', /.+/);

app.get('/force/:repo/:tag', function(req, res){
	var name = req.params.repo;
	var details = projects[name];
	if(!details){
		res.status(400).send(Strings.WEBHOOK_REPO_MISMATCH.replace('%s', name));
		return Log.info(Strings.WEBHOOK_REPO_MISMATCH.replace('%s', name));
	}

	var tag = req.params.tag;
	res.send(Strings.FORCED_CHECK_MESSAGE.replace('%s', name).replace('%s', tag));
	Log.info(Strings.FORCED_CHECK_MESSAGE.replace('%s', name).replace('%s', tag));

	details.tag = tag;
	new Packager(details, ++workID);
});

app.post('/', function(req, res, next){
	if(!req.headers['x-github-delivery']){
		res.status(400).end();
		return Log.error(Strings.WEBHOOK_NO_DELIVERY);
	}

	var signature = req.headers['x-hub-signature'],
		event = req.headers['x-github-event'];

	if(!signature){
		res.status(400).end();
		return Log.error(Strings.WEBHOOK_NO_SECRET);
	}

	if(!event){
		res.status(400).end();
		return Log.error(Strings.WEBHOOK_NO_EVENT);
	}

	req.pipe(bl(function(err, data){
		if(err){
			res.status(500).end();
			return Log.error(Strings.ERROR_MESSAGE.replace('%s', 'Webhook').replace('%s', err.message));
		}

		if(!signatureMatch(signature, data)){
			res.status(401).end();
			return Log.error(Strings.WEBHOOK_SIGN_MISMATCH);
		}

		try {
			res.payload = JSON.parse(data.toString());
		} catch(err){
			res.status(400).end();
			return Log.error(Strings.WEBHOOK_SYNTAX_ERROR);
		}

		res.event = event;

		next();
	}));
}, function(req, res){
	if(res.event === 'ping'){
		res.status(200).end();
		return Log.info(Strings.WEBHOOK_PING_MESSAGE.replace('%s', res.payload.zen));
	}

	if(res.event !== 'create'){
		res.status(204).end();
		return Log.info(Strings.WEBHOOK_EVENT_MISMATCH.replace('%s', res.event));
	}

	if(res.payload.ref_type !== 'tag'){
		res.status(204).end();
		return Log.info(Strings.WEBHOOK_REF_MISMATCH.replace('%s', res.payload.ref_type));
	}

	var name = res.payload.repository.name;
	var details = projects[name];
	if(!details){
		res.status(204).end();
		return Log.info(Strings.WEBHOOK_REPO_MISMATCH.replace('%s', name));
	}

	Log.info(Strings.WEBHOOK_RECEIVED_MESSAGE.replace('%s', name).replace('%s', res.payload.ref));

	details.tag = res.payload.ref;
	new Packager(details, ++workID);

	res.status(202).end();
});

function signatureMatch(signature, data){
	var computed = 'sha1=' + crypto.createHmac('sha1', process.env.SECRET_KEY).update(data).digest('hex');
	if(computed === signature)
		return true;
	else {
		Log.info(Strings.SIGN_PROVIDED.replace('%s', signature));
		Log.info(Strings.SIGN_COMPUTED.replace('%s', computed));
	}
}

request({
	url: 'https://api.github.com/gists/' + process.env.GIST_ID,
	json: true,
	headers: {
		'User-Agent': 'addon-packager-proxy'
	}
}, function(err, res, data){
	if(err)
		return Log.error(Strings.CONNECTION_ERROR.replace('%s', res.request.uri.href));

	if(!data.files)
		return Log.error(Strings.GIST_NOT_FOUND.replace('%s', process.env.GIST_ID));

	var file = data.files['addons.json'];
	if(!file)
		return Log.error(Strings.GIST_FILE_NOT_FOUND);

	var obj;
	try {
		obj = JSON.parse(file.content);
	} catch(err){
		return Log.error(Strings.GIST_SYNTAX_ERROR);
	}

	for(var index in obj)
		projects[obj[index].repo] = obj[index];

	Log.info(Strings.GIST_SUCCESSFUL);
});
