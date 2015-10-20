L.TileLayer.prototype.options.useCache = false;
L.TileLayer.prototype.options.saveToCache = true;
L.TileLayer.prototype.options.useOnlyCache = false;
L.TileLayer.prototype.options.cacheMaxAge = 24 * 3600 * 1000;


L.TileLayer.include({

    // Overwrites L.TileLayer.prototype._loadTile
    _loadTile: function (tile, tilePoint) {
        tile._layer = this;
        tile.onerror = this._tileOnError;

        this._adjustTilePoint(tilePoint);

        var tileUrl = this.getTileUrl(tilePoint);
        this.fire('tileloadstart', {
            tile: tile,
            url: tileUrl
        });

        if (this.options.useCache && this._canvas) {
            this._db.get('cache', tileUrl).then(function (data) {
                this._onCacheLookupBlob(tile, tileUrl, data);
            }.bind(this));
        } else {
            // Fall back to standard behaviour
            tile.onload = this._tileOnLoad;
            tile.src = tileUrl;
        }
    },
    _onCacheLookup: function (tile, tileUrl, data) {

        if (data) {
            this.fire('tilecachehit', {
                tile: tile,
                url: tileUrl
            });
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

                tile.onload = this._tileOnLoad;
                tile.src = data.dataUrl; // data.dataUrl is already a base64-encoded PNG image.

            }
        } else {
            this.fire('tilecachemiss', {
                tile: tile,
                url: tileUrl
            });
            if (this.options.useOnlyCache) {
                // Offline, not cached
                //                     console.log('Tile not in cache', tileUrl);
                tile.onload = this._tileOnLoad;
                tile.src = L.Util.emptyImageUrl;
            } else {
                // Online, not cached, request the tile normally
                //                     console.log('Requesting tile normally', tileUrl);
                if (this.options.saveToCache) {
                    tile.onload = this._saveTile(tileUrl);
                } else {
                    tile.onload = this._tileOnLoad;
                }
                tile.crossOrigin = 'Anonymous';
                tile.src = tileUrl;
            }
        }

    },
    // Returns a callback (closure over tile/key/originalSrc) to be run when the DB
    //   backend is finished with a fetch operation.
    _onCacheLookupBlob: function (tile, tileUrl, data) {

        if (data) {
            this.fire('tilecachehit', {
                tile: tile,
                url: tileUrl
            });
            if (Date.now() > data.timestamp + this.options.cacheMaxAge && !this.options.useOnlyCache) {
                // Tile is too old, try to refresh it
                //                     console.log('Tile is too old: ', tileUrl);

                var xhr = new XMLHttpRequest(),
                    blob,
                    fileReader = new FileReader();

                xhr.open("GET", tileUrl, true);
                // Set the responseType to arraybuffer. "blob" is an option too, rendering manual Blob creation unnecessary, but the support for "blob" is not widespread enough yet
                xhr.responseType = "blob";
                xhr.addEventListener("load", function () {
                    if (xhr.status === 200) {
                        tile.onload = function (ev) {
                            URL.revokeObjectURL(xhr.response);
                            L.TileLayer.prototype._tileOnLoad.call(ev.target, ev);
                        };

                        tile.src = URL.createObjectURL(xhr.response);
                        if (this.options.saveToCache) {
                            this._saveBlob(tileUrl, xhr.response);
                        }

                    } else {
                        tile.onload = this._tileOnLoad;
                        tile.src = L.Util.emptyImageUrl;
                    }
                }, false);
                // Send XHR
                xhr.send();



            } else {
                // Serve tile from cached data
                //                     console.log('Tile is cached: ', tileUrl);
                tile.onload = function (ev) {
                    URL.revokeObjectURL(data.dataUrl);
                    L.TileLayer.prototype._tileOnLoad.call(ev.target, ev);
                };

                tile.src = URL.createObjectURL(data.dataUrl);
            }
        } else {
            this.fire('tilecachemiss', {
                tile: tile,
                url: tileUrl
            });
            if (this.options.useOnlyCache) {
                // Offline, not cached
                //                     console.log('Tile not in cache', tileUrl);
                tile.onload = this._tileOnLoad;
                tile.src = L.Util.emptyImageUrl;
            } else {
                // Online, not cached, request the tile normally
                //                     console.log('Requesting tile normally', tileUrl);

                if (this.options.saveToCache) {
                    var xhr = new XMLHttpRequest(),
                        blob,
                        fileReader = new FileReader();

                    xhr.open("GET", tileUrl, true);
                    // Set the responseType to arraybuffer. "blob" is an option too, rendering manual Blob creation unnecessary, but the support for "blob" is not widespread enough yet
                    xhr.responseType = "blob";
                    xhr.addEventListener("load", function () {
                        if (xhr.status === 200) {
                            // Create a blob from the response
                            tile.onload = function (ev) {
                                URL.revokeObjectURL(xhr.response);
                                L.TileLayer.prototype._tileOnLoad.call(ev.target, ev);
                            };
                            tile.src = URL.createObjectURL(xhr.response);
                            this._saveBlob(tileUrl, xhr.response);

                        } else {
                            tile.onload = this._tileOnLoad;
                            tile.src = L.Util.emptyImageUrl;
                        }
                    }.bind(this), false);
                    // Send XHR
                    xhr.send();



                } else {
                    tile.onload = this._tileOnLoad;
                    tile.crossOrigin = 'Anonymous';
                    tile.src = tileUrl;
                }
            }
        }

    },
    _tileOnLoadBlob: function () {

    },
    _saveBlob: function (tileUrl, blob) {


        var doc = {
            i: tileUrl,
            dataUrl: blob,
            timestamp: Date.now()
        };


        this._db.put('cache', doc);
    },
    // Returns an event handler (closure over DB key), which runs
    //   when the tile (which is an <img>) is ready.
    // The handler will delete the document from pouchDB if an existing revision is passed.
    //   This will keep just the latest valid copy of the image in the cache.
    _saveTile: function (tileUrl) {
        return function (ev) {
            if (this._canvas === null) return;
            var img = ev.target;
            L.TileLayer.prototype._tileOnLoad.call(img, ev);
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
    },


    // Seeds the cache given a bounding box (latLngBounds), and
    //   the minimum and maximum zoom levels
    // Use with care! This can spawn thousands of requests and
    //   flood tileservers!
    seedCalcLayers: function (layers, minZoom, maxZoom) {
        var maxZoom = maxZoom + 1;
        if (minZoom > maxZoom) return;
        if (!this._map) return;

        var index = {};

        var tileSize = this._getTileSize();
        for (var a = 0; a < layers.length; a++) {
            var bbox = layers[a].getBounds();

            for (var z = minZoom; z < maxZoom; z++) {

                var northEastPoint = this._map.project(bbox.getNorthEast(), z);
                var southWestPoint = this._map.project(bbox.getSouthWest(), z);

                // Calculate tile indexes as per L.TileLayer._update and
                //   L.TileLayer._addTilesFromCenterOut

                var tileBounds = L.bounds(
                    northEastPoint.divideBy(tileSize)._floor(),
                    southWestPoint.divideBy(tileSize)._floor());

                for (var j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
                    for (var i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
                        point = new L.Point(i, j);
                        point.z = z;
                        index[this.getTileUrl(point)] = {};
                    }
                }
            }
        }
        var queue = [];
        for (var key in index) {
            queue.push(key);
        }
        console.log(n);
        return queue.length;
    },
    seedLayers: function (layers, minZoom, maxZoom) {
        var maxZoom = maxZoom + 1;
        if (minZoom > maxZoom) return;
        if (!this._map) return;

        var index = {};

        var tileSize = this._getTileSize();
        for (var a = 0; a < layers.length; a++) {
            var bbox = layers[a].getBounds();

            for (var z = minZoom; z < maxZoom; z++) {

                var northEastPoint = this._map.project(bbox.getNorthEast(), z);
                var southWestPoint = this._map.project(bbox.getSouthWest(), z);

                // Calculate tile indexes as per L.TileLayer._update and
                //   L.TileLayer._addTilesFromCenterOut

                var tileBounds = L.bounds(
                    northEastPoint.divideBy(tileSize)._floor(),
                    southWestPoint.divideBy(tileSize)._floor());

                for (var j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
                    for (var i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
                        point = new L.Point(i, j);
                        point.z = z;
                        index[this.getTileUrl(point)] = {};
                    }
                }
            }
        }
        var queue = [];
        for (var key in index) {
            queue.push(key);
        }

        var seedData = {
            bbox: bbox,
            minZoom: minZoom,
            maxZoom: maxZoom,
            queueLength: queue.length
        }
        this.fire('seedstart', seedData);
        var tile = this._createTile();
        tile._layer = this;
        this._seedOneTile(tile, queue, seedData);
    },

    seedLayersBlob: function (layers, minZoom, maxZoom) {
        var maxZoom = maxZoom + 1;
        if (minZoom > maxZoom) return;
        if (!this._map) return;

        var index = {};

        var tileSize = this._getTileSize();
        for (var a = 0; a < layers.length; a++) {
            var bbox = layers[a].getBounds();

            for (var z = minZoom; z < maxZoom; z++) {

                var northEastPoint = this._map.project(bbox.getNorthEast(), z);
                var southWestPoint = this._map.project(bbox.getSouthWest(), z);

                // Calculate tile indexes as per L.TileLayer._update and
                //   L.TileLayer._addTilesFromCenterOut

                var tileBounds = L.bounds(
                    northEastPoint.divideBy(tileSize)._floor(),
                    southWestPoint.divideBy(tileSize)._floor());

                for (var j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
                    for (var i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
                        point = new L.Point(i, j);
                        point.z = z;
                        index[this.getTileUrl(point)] = {};
                    }
                }
            }
        }
        var queue = [];
        for (var key in index) {
            queue.push(key);
        }

        var seedData = {
            bbox: bbox,
            minZoom: minZoom,
            maxZoom: maxZoom,
            queueLength: queue.length
        }
        this.fire('seedstart', seedData);
        this._seedOneTileBlob(queue, seedData);
    },



    seed: function (bbox, minZoom, maxZoom) {
        if (minZoom > maxZoom) return;
        if (!this._map) return;

        var queue = [];

        for (var z = minZoom; z < maxZoom; z++) {

            var northEastPoint = this._map.project(bbox.getNorthEast(), z);
            var southWestPoint = this._map.project(bbox.getSouthWest(), z);

            // Calculate tile indexes as per L.TileLayer._update and
            //   L.TileLayer._addTilesFromCenterOut
            var tileSize = this._getTileSize();
            var tileBounds = L.bounds(
                northEastPoint.divideBy(tileSize)._floor(),
                southWestPoint.divideBy(tileSize)._floor());

            for (var j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
                for (var i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
                    point = new L.Point(i, j);
                    point.z = z;
                    queue.push(this.getTileUrl(point));
                }
            }
        }

        var seedData = {
            bbox: bbox,
            minZoom: minZoom,
            maxZoom: maxZoom,
            queueLength: queue.length
        }
        this.fire('seedstart', seedData);
        var tile = this._createTile();
        tile._layer = this;
        this._seedOneTile(tile, queue, seedData);
    },

    // Uses a defined tile to eat through one item in the queue and
    //   asynchronously recursively call itself when the tile has
    //   finished loading.
    _seedOneTile: function (tile, remaining, seedData) {
        if (!remaining.length) {
            this.fire('seedend', seedData);
            return;
        }
        this.fire('seedprogress', {
            bbox: seedData.bbox,
            minZoom: seedData.minZoom,
            maxZoom: seedData.maxZoom,
            queueLength: seedData.queueLength,
            remainingLength: remaining.length
        });

        var url = remaining.pop();

        this._db.get('cache', url).then(function (data) {
            if (!data) {
                /// FIXME: Do something on tile error!!
                tile.onload = function (ev) {
                    this._saveTile(url)(ev);
                    this._seedOneTile(tile, remaining, seedData);
                }.bind(this);
                tile.crossOrigin = 'Anonymous';
                tile.src = url;
            } else {
                this._seedOneTile(tile, remaining, seedData);
            }
        }.bind(this)).catch(function (err) {});

    },
    _seedOneTileBlob: function (remaining, seedData) {
        if (!remaining.length) {
            this.fire('seedend', seedData);
            return;
        }
        this.fire('seedprogress', {
            bbox: seedData.bbox,
            minZoom: seedData.minZoom,
            maxZoom: seedData.maxZoom,
            queueLength: seedData.queueLength,
            remainingLength: remaining.length
        });

        var url = remaining.pop();

        this._db.get('cache', url).then(function (data) {
            if (!data) {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.responseType = "blob";
                xhr.addEventListener("load", function () {
                    if (xhr.status === 200) {
                        this._saveBlob(url, xhr.response);
                        this._seedOneTileBlob(remaining, seedData);
                    }
                }.bind(this), false);
                xhr.send();
            } else {
                this._seedOneTileBlob(remaining, seedData);
            }
        }.bind(this)).catch(function (err) {});

    }

});
