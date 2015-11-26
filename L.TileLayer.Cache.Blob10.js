(function (window, console, L, Promise, blobUtil) {
    'use strict';
    L.TileLayer.prototype.options.useCache = false;
    L.TileLayer.prototype.options.saveToCache = true;
    L.TileLayer.prototype.options.useOnlyCache = false;
    L.TileLayer.prototype.options.cacheMaxAge = 24 * 3600 * 1000;

    L.TileLayer.include({

        // Overwrites L.TileLayer.prototype.createTile

        createTile: function (coords, done) {
            var tile = document.createElement('img');

            //L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
            L.DomEvent.on(tile, 'error', L.bind(this._tileOnError, this, done, tile));

            if (this.options.crossOrigin) {
                tile.crossOrigin = '';
            }

            /*
             Alt tag is set to empty string to keep screen readers from reading URL and for compliance reasons
             http://www.w3.org/TR/WCAG20-TECHS/H67
            */
            tile.alt = '';

            var tileUrl = this.getTileUrl(coords);

            this._loadTileBlob(tileUrl).then(function (data) {
                return this._onCacheLookup(tileUrl, data);
            }.bind(this)).then(function (blob) {
                tile.onload = function (ev) {
                    URL.revokeObjectURL(blob);
                    this._tileOnLoad(done, ev.target);
                }.bind(this);
                tile.src = URL.createObjectURL(blob);
            }.bind(this)).catch(function (err) {
                L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
                //tile.src = tileUrl;
                if (navigator.userAgent.indexOf('Chrome') !== -1) {
                    tile.src = L.Util.emptyImageUrl;
                } else {
                    tile.src = 'img/empty.png';
                }
            }.bind(this));
            return tile;
        },


        _loadTileBlob: function (tileUrl) {
            if (this.options.useCache) {
                return this._db.get('cache', tileUrl);
            }
            return Promise.resolve(null);
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
                                if (navigator.userAgent.indexOf('Chrome') !== -1) {
                                    this._saveBlob(tileUrl, blob);
                                } else {
                                    this._saveBase64(tileUrl, blob);
                                }
                            }
                            resolve(blob);
                        }.bind(this)).catch(function () {
                            resolve(data.d);
                        });
                    } else {
                        // Serve tile from cached data
                        // console.log('Tile is cached: ', tileUrl);



                        if (navigator.userAgent.indexOf('Chrome') !== -1) {
                            resolve(data.d);
                        } else {
                            blobUtil.base64StringToBlob(data.d).then(function (blob) {
                                resolve(blob);
                            }).catch(function (err) {
                                reject(err);
                            });
                        }
                    }
                } else {
                    if (this.options.useOnlyCache) {
                        // Offline, not cached
                        // console.log('Tile not in cache', tileUrl);
                        reject();
                    } else {
                        // Online, not cached, request the tile normally
                        // console.log('Requesting tile normally', tileUrl);
                        this._getOnlineTile(tileUrl).then(function (blob) {
                            if (this.options.saveToCache) {
                                if (navigator.userAgent.indexOf('Chrome') !== -1) {
                                    this._saveBlob(tileUrl, blob);
                                } else {
                                    this._saveBase64(tileUrl, blob);
                                }
                            }
                            resolve(blob);
                        }.bind(this)).catch(function () {
                            reject();
                        });
                    }
                }
            }.bind(this));
        },

        _saveBase64: function (tileUrl, blob) {
            blobUtil.blobToBase64String(blob).then(function (base64String) {
                var doc = {
                    i: tileUrl,
                    d: base64String,
                    t: Date.now()
                };

                this._db.put('cache', doc);
            }.bind(this)).catch(function (err) {
                console.log(err);
            });

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

            var tileSize = 256;
            for (var a = 0; a < layers.length; a++) {
                var bbox = layers[a].getBounds();

                for (var z = minZoom; z < maxZoom; z++) {
                    this._tileZoom = z;

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
            this._tileZoom = null;
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
                return Promise.reject({
                    exist: true
                });
            }.bind(this)).then(function (blob) {
                if (navigator.userAgent.indexOf('Chrome') !== -1) {
                    return this._saveBlob(url, blob);
                } else {
                    return this._saveBase64(url, blob);
                }
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
                    errors: (err && err.exist) ? 0 : 1
                });
                this._seedOneTile(remaining, seedData);
            }.bind(this));

        }

    });
}(this, this.console, this.L, this.Promise, this.blobUtil));
