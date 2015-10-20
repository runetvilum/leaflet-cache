(function (window, console, L, Promise) {
    'use strict';
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
            this._loadTileBlob(tileUrl).then(function (data) {
                return this._onCacheLookup(tileUrl, data);
            }.bind(this)).then(function (blob) {
                tile.onload = function (ev) {
                    URL.revokeObjectURL(blob);
                    L.TileLayer.prototype._tileOnLoad.call(ev.target, ev);
                };
                tile.src = URL.createObjectURL(blob);
            }).catch(function (err) {
                console.log(err);
                tile.onload = this._tileOnLoad;
                tile.src = tileUrl;
            }.bind(this));
        },
        _loadTileBlob: function (tileUrl) {
            if (this.options.useCache) {
                return this._db.get('cache', tileUrl);
            }
            return Promise.reject();
        },
        _getOnlineTile: function (tileUrl) {
            return new Promise(function (resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.responseType = "blob";
                xhr.addEventListener("error", reject);
                xhr.addEventListener("abort", reject);
                xhr.addEventListener("load", function () {
                    if (xhr.status === 200) {
                        resolve(xhr.response);
                    } else {
                        reject();
                    }
                }, false);
                // Send XHR
                xhr.open("GET", tileUrl, true);
                xhr.send();
            });

        },
        // Returns a callback (closure over tile/key/originalSrc) to be run when the DB
        //   backend is finished with a fetch operation.
        _onCacheLookup: function (tileUrl, data) {
            return new Promise(function (resolve, reject) {
                if (data) {
                    if (Date.now() > data.t + this.options.cacheMaxAge && !this.options.useOnlyCache) {
                        // Tile is too old, try to refresh it
                        // console.log('Tile is too old: ', tileUrl);
                        this._getOnlineTile(tileUrl).then(function (blob) {
                            if (this.options.saveToCache) {
                                this._saveBlob(tileUrl, blob);
                            }
                            resolve(blob);
                        }.bind(this)).catch(function () {
                            resolve(data.d);
                        });
                    } else {
                        // Serve tile from cached data
                        // console.log('Tile is cached: ', tileUrl);
                        resolve(data.d);
                    }
                } else {
                    if (this.options.useOnlyCache) {
                        // Offline, not cached
                        // console.log('Tile not in cache', tileUrl);
                        reject();
                    } else {
                        // Online, not cached, request the tile normally
                        // console.log('Requesting tile normally', tileUrl);

                        if (this.options.saveToCache) {
                            this._getOnlineTile(tileUrl).then(function (blob) {
                                this._saveBlob(tileUrl, blob);
                                resolve(blob);
                            }.bind(this)).catch(function () {
                                reject();
                            });
                        } else {
                            reject();
                        }
                    }
                }
            }.bind(this));
        },
        _saveBlob: function (tileUrl, blob) {
            var doc = {
                i: tileUrl,
                d: blob,
                t: Date.now()
            };
            this._db.put('cache', doc);
        },

        // Seeds the cache given a bounding box (latLngBounds), and
        //   the minimum and maximum zoom levels
        // Use with care! This can spawn thousands of requests and
        //   flood tileservers!
        seedCalcLayers: function (layers, minZoom, maxZoom) {
            maxZoom = maxZoom + 1;
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
                            var point = new L.Point(i, j);
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
            return queue.length;
        },


        seedLayers: function (layers, minZoom, maxZoom) {
            maxZoom = maxZoom + 1;
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
                            var point = new L.Point(i, j);
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
                queueLength: queue.length,
                errors: 0
            }
            this.fire('seedstart', seedData);
            this._seedOneTile(queue, seedData);
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
                        var point = new L.Point(i, j);
                        point.z = z;
                        queue.push(this.getTileUrl(point));
                    }
                }
            }

            var seedData = {
                bbox: bbox,
                minZoom: minZoom,
                maxZoom: maxZoom,
                queueLength: queue.length,
                errors: 0
            }
            this.fire('seedstart', seedData);
            this._seedOneTile(queue, seedData);
        },


        _seedOneTile: function (remaining, seedData) {
            if (!remaining.length) {
                this.fire('seedend', seedData);
                return;
            }


            var url = remaining.pop();

            this._db.get('cache', url).then(function (data) {
                if (!data || (data && Date.now() > data.t + this.options.cacheMaxAge)) {
                    return this._getOnlineTile(url);
                }
                return Promise.reject({exist:true});
            }.bind(this)).then(function (blob) {
                return this._saveBlob(url, blob);
            }.bind(this)).then(function () {
                this.fire('seedprogress', {
                    bbox: seedData.bbox,
                    minZoom: seedData.minZoom,
                    maxZoom: seedData.maxZoom,
                    queueLength: seedData.queueLength,
                    remainingLength: remaining.length,
                    errors: seedData.errors
                });
                this._seedOneTile(remaining, seedData);
            }.bind(this), function (err) {
                this.fire('seedprogress', {
                    bbox: seedData.bbox,
                    minZoom: seedData.minZoom,
                    maxZoom: seedData.maxZoom,
                    queueLength: seedData.queueLength,
                    remainingLength: remaining.length,
                    errors: err.exist?0:1
                });
                this._seedOneTile(remaining, seedData);
            }.bind(this));

        }

    });
} (this, this.console, this.L, this.Promise));
