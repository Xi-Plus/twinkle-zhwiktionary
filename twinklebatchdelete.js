/*
 ****************************************
 *** twinklebatchdelete.js: Batch delete module (sysops only)
 ****************************************
 * Mode of invocation:     Tab ("D-batch")
 * Active on:              Existing and non-existing non-articles, and Special:PrefixIndex
 * Config directives in:   TwinkleConfig
 */


function twinklebatchdelete() {
	if( userIsInGroup( 'sysop' ) && (wgNamespaceNumber > 0 || wgCanonicalSpecialPageName == 'Prefixindex') ) {
		twAddPortletLink( "javascript:twinklebatchdelete.callback()", "D-batch", "tw-batch", "Delete pages found in this category/on this page", "");
	}
}

twinklebatchdelete.unlinkCache = {};
twinklebatchdelete.callback = function twinklesbatchdeleteCallback() {
	var Window = new SimpleWindow( 800, 400 );
	Window.setTitle( "Batch deletion" );
	Window.setScriptName( "Twinkle" );
	Window.addFooterLink( "Twinkle help", "WP:TW/DOC#batchdelete" );

	var form = new QuickForm( twinklebatchdelete.callback.evaluate );
	form.append( {
			type: 'checkbox',
			list: [
				{ 
					label: 'Delete pages',
					name: 'delete_page',
					value: 'delete',
					checked: true
				},
				{
					label: 'Remove backlinks to the page',
					name: 'unlink_page',
					value: 'unlink',
					checked: true
				},
				{
					label: 'Delete redirects to deleted pages',
					name: 'delete_redirects',
					value: 'delete_redirects',
					checked: true
				}
			]
		} );
	form.append( {
			type: 'textarea',
			name: 'reason',
			label: 'Reason: '
		} );
	if( wgNamespaceNumber == Namespace.CATEGORY ) {

		var query = {
			'action': 'query',
			'generator': 'categorymembers',
			'gcmtitle': wgPageName,
			'gcmlimit' : TwinkleConfig.batchMax, // the max for sysops
			'prop': [ 'categories', 'revisions' ],
			'rvprop': [ 'size' ]
		};
	} else if( wgCanonicalSpecialPageName == 'Prefixindex' ) {

		if(QueryString.exists( 'from' ) )
		{
			var gapnamespace = QueryString.get( 'namespace' );
			var gapprefix = QueryString.get( 'from' ).toUpperCaseFirstChar();
		}
		else
		{
			var pathSplit = location.pathname.split('/');
			if (pathSplit.length<3 || pathSplit[2]!="Special:PrefixIndex") return;
			var titleSplit = pathSplit[3].split(':');
			var gapnamespace = Namespace[titleSplit[0].toUpperCase()];
			if ( titleSplit.length<2 || typeof(gapnamespace)=='undefined' )
			{
				var gapnamespace = Namespace.MAIN;
				var gapprefix = pathSplit.splice(3).join('/');
			}
			else
			{
				pathSplit = pathSplit.splice(4);
				pathSplit.splice(0,0,titleSplit.splice(1).join(':'));
				var gapprefix = pathSplit.join('/');
			}
		}

		var query = {
			'action': 'query',
			'generator': 'allpages',
			'gapnamespace': gapnamespace ,
			'gapprefix': gapprefix,
			'gaplimit' : TwinkleConfig.batchMax, // the max for sysops
			'prop' : ['categories', 'revisions' ],
			'rvprop': [ 'size' ]
		}
	} else {
		var query = {
			'action': 'query',
			'generator': 'links',
			'titles': wgPageName,
			'gpllimit' : TwinkleConfig.batchMax, // the max for sysops
			'prop': [ 'categories', 'revisions' ],
			'rvprop': [ 'size' ]
		};
	}

	var wikipedia_api = new Wikipedia.api( 'Grabbing pages', query, function( self ) {
			var xmlDoc = self.responseXML;
			var snapshot = xmlDoc.evaluate('//page[@ns != "' + Namespace.IMAGE + '" and not(@missing)]', xmlDoc, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null );
			var list = [];
			for ( var i = 0; i < snapshot.snapshotLength; ++i ) {
				var object = snapshot.snapshotItem(i);
				var page = xmlDoc.evaluate( '@title', object, null, XPathResult.STRING_TYPE, null ).stringValue;
				var size = xmlDoc.evaluate( 'revisions/rev/@size', object, null, XPathResult.NUMBER_TYPE, null ).numberValue;

				var disputed = xmlDoc.evaluate( 'boolean(categories/cl[@title="Category:Contested candidates for speedy deletion"])', object, null, XPathResult.BOOLEAN_TYPE, null ).booleanValue;
				list.push( {label:page + ' (' + size + ')' + ( disputed ? ' DISPUTED' : '' ), value:page, checked:!disputed });
			}
			self.params.form.append( {
					type: 'checkbox',
					name: 'pages',
					list: list
				}
			)
			self.params.form.append( { type:'submit' } );

			var result = self.params.form.render();
			self.params.Window.setContent( result );


		}  );

	wikipedia_api.params = { form:form, Window:Window };
	wikipedia_api.post();
	var root = document.createElement( 'div' );
	Status.init( root );
	Window.setContent( root );
	Window.display();
}

twinklebatchdelete.currentDeleteCounter = 0;
twinklebatchdelete.currentUnlinkCounter = 0;
twinklebatchdelete.currentdeletor;
twinklebatchdelete.callback.evaluate = function twinklebatchdeleteCallbackEvaluate(event) {
	Wikipedia.actionCompleted.notice = 'Status';
	Wikipedia.actionCompleted.postfix = 'batch deletion is now complete';
	wgPageName = wgPageName.replace( /_/g, ' ' ); // for queen/king/whatever and country!
	var pages = event.target.getChecked( 'pages' );
	var reason = event.target.reason.value;
	var delete_page = event.target.delete_page.checked;
	var unlink_page = event.target.unlink_page.checked;
	var delete_redirects = event.target.delete_redirects.checked;
	if( ! reason ) {
		return;
	}
	SimpleWindow.setButtonsEnabled( false );
	Status.init( event.target );
	if( !pages ) {
		Status.error( 'Error', 'nothing to delete, aborting' );
		return;
	}

	function toCall( work ) {
		if( work.length == 0 &&  twinklebatchdelete.currentDeleteCounter <= 0 && twinklebatchdelete.currentUnlinkCounter <= 0 ) {
			window.clearInterval( twinklebatchdelete.currentdeletor );
			Wikipedia.removeCheckpoint();
			return;
		} else if( work.length != 0 && ( twinklebatchdelete.currentDeleteCounter <= TwinkleConfig.batchDeleteMinCutOff || twinklebatchdelete.currentUnlinkCounter <= TwinkleConfig.batchDeleteMinCutOff  ) ) {
			twinklebatchdelete.unlinkCache = []; // Clear the cache
			var pages = work.shift();
			twinklebatchdelete.currentDeleteCounter += pages.length;
			twinklebatchdelete.currentUnlinkCounter += pages.length;
			for( var i = 0; i < pages.length; ++i ) {
				var page = pages[i];
				var query = {
					'action': 'query',
					'titles': page
				}
				var wikipedia_api = new Wikipedia.api( 'Checking if page ' + page + ' exists', query, twinklebatchdelete.callbacks.main );
				wikipedia_api.params = { page:page, reason:reason, unlink_page:unlink_page, delete_page:delete_page, delete_redirects:delete_redirects };
				wikipedia_api.post();
			}
		}
	}
	var work = pages.chunk( TwinkleConfig.batchdeleteChunks );
	Wikipedia.addCheckpoint();
	twinklebatchdelete.currentdeletor = window.setInterval( toCall, 1000, work );
}
twinklebatchdelete.callbacks = {
	main: function( self ) {
		var xmlDoc = self.responseXML;
		var normal = xmlDoc.evaluate( '//normalized/n/@to', xmlDoc, null, XPathResult.STRING_TYPE, null ).stringValue;
		if( normal ) {
			self.params.page = normal;
		}
		var exists = xmlDoc.evaluate( 'boolean(//pages/page[not(@missing)])', xmlDoc, null, XPathResult.BOOLEAN_TYPE, null ).booleanValue;

		if( ! exists ) {
			self.statelem.error( "It seems that the page doesn't exist, perhaps it has already been deleted" );
			return;
		}
		if( self.params.unlink_page ) {
			var query = {
				'action': 'query',
				'list': 'backlinks',
				'blfilterredir': 'nonredirects',
				'blnamespace': [0, 100], // main space and portal space only
				'bltitle': self.params.page,
				'bllimit': userIsInGroup( 'sysop' ) ? 5000 : 500 // 500 is max for normal users, 5000 for bots and sysops
			};
			var wikipedia_api = new Wikipedia.api( 'Grabbing backlinks', query, twinklebatchdelete.callbacks.unlinkBacklinksMain );
			wikipedia_api.params = self.params;
			wikipedia_api.post();
		} else {
			--twinklebatchdelete.currentUnlinkCounter;
		}
		if( self.params.delete_page ) {
			if (self.params.delete_redirects)
			{
				var query = {
					'action': 'query',
					'list': 'backlinks',
					'blfilterredir': 'redirects',
					'bltitle': self.params.page,
					'bllimit': userIsInGroup( 'sysop' ) ? 5000 : 500 // 500 is max for normal users, 5000 for bots and sysops
				};
				var wikipedia_api = new Wikipedia.api( 'Grabbing backlinks', query, twinklebatchdelete.callbacks.deleteRedirectsMain );
				wikipedia_api.params = self.params;
				wikipedia_api.post();
			}

			var wikipedia_page = new Wikipedia.page( self.params.page, 'Deleting page ' + self.params.page );
			wikipedia_page.setEditSummary(self.params.reason + TwinkleConfig.deletionSummaryAd);
			wikipedia_page.deletePage(function( apiobj ) { 
					--twinklebatchdelete.currentDeleteCounter;
					var link = document.createElement( 'a' );
					link.setAttribute( 'href', wgArticlePath.replace( '$1', self.params.page ) );
					link.setAttribute( 'title', self.params.page );
					link.appendChild( document.createTextNode( self.params.page ) );
					apiobj.statelem.info( [ 'completed (' , link , ')' ] );

				} );	
		} else {
			--twinklebatchdelete.currentDeleteCounter;
		}
	},
	deleteRedirectsMain: function( self ) {
		var xmlDoc = self.responseXML;
		var snapshot = xmlDoc.evaluate('//backlinks/bl/@title', xmlDoc, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null );

		var total = snapshot.snapshotLength;

		if( snapshot.snapshotLength == 0 ) {
			return;
		}

		var statusIndicator = new Status('Deleting redirects', '0%');

		var onsuccess = function( self ) {
			var obj = self.params.obj;
			var total = self.params.total;
			var now = parseInt( 100 * ++(self.params.current)/total ) + '%';
			obj.update( now );
			self.statelem.unlink();
			if( self.params.current >= total ) {
				obj.info( now + ' (completed)' );
				Wikipedia.removeCheckpoint();
			}
		}


		Wikipedia.addCheckpoint();
		if( snapshot.snapshotLength == 0 ) {
			statusIndicator.info( '100% (completed)' );
			Wikipedia.removeCheckpoint();
			return;
		}

		var params = clone( self.params );
		params.current = 0;
		params.total = total;
		params.obj = statusIndicator;


		for ( var i = 0; i < snapshot.snapshotLength; ++i ) {
			var title = snapshot.snapshotItem(i).value;
			var wikipedia_page = new Wikipedia.page( title, "Deleting " + title );
			wikipedia_page.setEditSummary('[[WP:CSD#G8|G8]]: Redirect to deleted page "' + self.params.page + '"' + TwinkleConfig.deletionSummaryA);
			wikipedia_page.setCallbackParameters(params);
			wikipedia_page.deletePage(onsuccess);
		}
	},
	unlinkBacklinksMain: function( self ) {
		var xmlDoc = self.responseXML;
		var snapshot = xmlDoc.evaluate('//backlinks/bl/@title', xmlDoc, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null );

		if( snapshot.snapshotLength == 0 ) {
			--twinklebatchdelete.currentUnlinkCounter;
			return;
		}

		var statusIndicator = new Status('Unlinking backlinks', '0%');

		var total = snapshot.snapshotLength * 2;

		var onsuccess = function( self ) {
			var obj = self.params.obj;
			var total = self.params.total;
			var now = parseInt( 100 * ++(self.params.current)/total ) + '%';
			obj.update( now );
			self.statelem.unlink();
			if( self.params.current >= total ) {
				obj.info( now + ' (completed)' );
				--twinklebatchdelete.currentUnlinkCounter;
				Wikipedia.removeCheckpoint();
			}
		}

		Wikipedia.addCheckpoint();
		if( snapshot.snapshotLength == 0 ) {
			statusIndicator.info( '100% (completed)' );
			--twinklebatchdelete.currentUnlinkCounter;
			Wikipedia.removeCheckpoint();
			return;
		}
		self.params.total = total;
		self.params.obj = statusIndicator;
		self.params.current =   0;

		for ( var i = 0; i < snapshot.snapshotLength; ++i ) {
			var title = snapshot.snapshotItem(i).value;
			var wikipedia_page = new Wikipedia.page( title, "Unlinking on " + title );
			var params = clone( self.params );
			params.title = title;
			params.onsuccess = onsuccess;
			wikipedia_page.setCallbackParameters(params);
			wikipedia_page.load(twinklebatchdelete.callbacks.unlinkBacklinks);
		}
	},
	unlinkBacklinks: function( pageobj ) {
		var params = pageobj.getCallbackParameters();
		if( ! pageobj.exists() ) {
			// we probably just deleted it, as a recursive backlink
			params.onsuccess( { params: params, statelem: pageobj.getStatusElement() } );
			Wikipedia.actionCompleted();
			return;
		}
		var text;

		if( params.title in twinklebatchdelete.unlinkCache ) {
			text = twinklebatchdelete.unlinkCache[ params.title ];
		} else {
			text = pageobj.getPageText();
		}
		var old_text = text;
		var wikiPage = new Mediawiki.Page( text );
		wikiPage.removeLink( params.page );

		text = wikiPage.getText();
		twinklebatchdelete.unlinkCache[ params.title ] = text;
		if( text == old_text ) {
			// Nothing to do, return
			params.onsuccess( { params: params, statelem: pageobj.getStatusElement() } );
			Wikipedia.actionCompleted();
			return;
		}
		pageobj.setEditSummary('Removing backlinks to deleted page ' + self.params.page + TwinkleConfig.deletionSummaryAd);
		pageobj.setPageText(text);
		pageobj.setCreateOption('nocreate');
		pageobj.save(params.onsuccess);
	}
}
