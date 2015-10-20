L.Icon.prototype.options.useCache = true;
L.Icon.prototype.options.saveToCache = true;
L.Icon.prototype.options.useOnlyCache = false;
L.Icon.prototype.options.cacheMaxAge = 24 * 3600 * 1000;


L.Icon.include({

    _createImg: function (src, el) {
        el = el || document.createElement('img');

        if (this.options.useCache && this._canvas) {
            this._db.get('cache', src).then(function (data) {
                this._onCacheLookup(el, src, data);
            }.bind(this));
        } else {


            el.src = src;

        }
        return el;
    },





    // Returns a callback (closure over tile/key/originalSrc) to be run when the DB
    //   backend is finished with a fetch operation.
    _onCacheLookup: function (tile, tileUrl, data) {

        if (data) {
            if (Date.now() > data.timestamp + this.options.cacheMaxAge && !this.options.useOnlyCache) {
                // Tile is too old, try to refresh it
                //                     console.log('Tile is too old: ', tileUrl);

                if (this.options.saveToCache) {
                    tile.onload = this._saveTile(tileUrl);
                }
                tile.crossOrigin = 'Anonymous';
                tile.src = tileUrl;
                tile.onerror = function (ev) {
                    // If the tile is too old but couldn't be fetched from the network,
                    //   serve the one still in cache.
                    this.src = data.dataUrl;
                }
            } else {
                // Serve tile from cached data
                //                     console.log('Tile is cached: ', tileUrl);
                //tile.onload = this._tileOnLoad;
                tile.src = data.dataUrl; // data.dataUrl is already a base64-encoded PNG image.
            }
        } else {
            if (this.options.useOnlyCache) {
                // Offline, not cached
                //                     console.log('Tile not in cache', tileUrl);
                //tile.onload = this._tileOnLoad;
                tile.src = L.Util.emptyImageUrl;
            } else {
                // Online, not cached, request the tile normally
                //                     console.log('Requesting tile normally', tileUrl);
                if (this.options.saveToCache) {
                    tile.onload = this._saveTile(tileUrl);
                } else {
                    //tile.onload = this._tileOnLoad;
                }
                tile.crossOrigin = 'Anonymous';
                tile.src = tileUrl;
            }
        }

    },

    // Returns an event handler (closure over DB key), which runs
    //   when the tile (which is an <img>) is ready.
    // The handler will delete the document from pouchDB if an existing revision is passed.
    //   This will keep just the latest valid copy of the image in the cache.
    _saveTile: function (tileUrl) {
        return function (ev) {
            if (this._canvas === null) return;
            var img = ev.target;
            //L.TileLayer.prototype._tileOnLoad.call(img, ev);
            this._canvas.width = img.naturalWidth || img.width;
            this._canvas.height = img.naturalHeight || img.height;

            var context = this._canvas.getContext('2d');
            context.drawImage(img, 0, 0);

            var dataUrl = this._canvas.toDataURL('image/png');

            var doc = {
                i: tileUrl,
                dataUrl: dataUrl,
                timestamp: Date.now()
            };


            this._db.put('cache', doc);
        }.bind(this);
    }

});
