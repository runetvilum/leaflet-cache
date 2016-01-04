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
            L.DomEvent.on(tile, 'error', L.bind(this._tileOnError, this, done, tile));
            if (this.options.crossOrigin) {
                tile.crossOrigin = '';
            }
            tile.alt = '';
            if (this.options.useCache) {
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
            } else {
                L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
                tile.src = this.getTileUrl(coords);
            }
            return tile;
        },


        _loadTileBlob: function (tileUrl) {
            if (this.options.useCache) {
                return this._db.get('data', tileUrl);
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

                this._db.put('data', doc);
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

            this._db.put('data', doc);
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

        pointToTileFraction: function (lon, lat, z) {
            var point = this._map.project(L.latLng(lat, lon), z).divideBy(256);
            return [point.x, point.y, z];
        },

        pointToTile: function (lon, lat, z) {
            var tile = this.pointToTileFraction(lon, lat, z);
            tile[0] = Math.floor(tile[0]);
            tile[1] = Math.floor(tile[1]);
            return tile;
        },
        geojson: function (geom, limits) {
            return {
                type: 'FeatureCollection',
                features: this.getTiles(geom, limits).map(this.tileToFeature, this)
            };
        },
        tileToFeature: function (t) {
            return {
                type: 'Feature',
                geometry: this.tileToGeoJSON(t),
                properties: { x: t[0], y: t[1], z: t[2] }
            };
        },
        tileToGeoJSON: function (tile) {
            var ne = this._map.unproject(L.point(tile[0], tile[1] + 1).multiplyBy(256), tile[2]);
            var nw = this._map.unproject(L.point(tile[0] + 1, tile[1] + 1).multiplyBy(256), tile[2]);
            var sw = this._map.unproject(L.point(tile[0] + 1, tile[1]).multiplyBy(256), tile[2]);
            var se = this._map.unproject(L.point(tile[0], tile[1]).multiplyBy(256), tile[2]);
            var poly = {
                type: 'Polygon',
                coordinates:
                [
                    [
                        [se.lng, se.lat],
                        [sw.lng, sw.lat],
                        [nw.lng, nw.lat],
                        [ne.lng, ne.lat],
                        [se.lng, se.lat]
                    ]
                ]
            };
            return poly;
        },
        getTiles: function (geom, limits) {
            var i, tile,
                coords = geom.coordinates,
                maxZoom = limits.max_zoom,
                tileHash = {},
                tiles = [];

            if (geom.type === 'Point') {
                return [this.pointToTile(coords[0], coords[1], maxZoom)];

            } else if (geom.type === 'MultiPoint') {
                for (i = 0; i < coords.length; i++) {

                    tile = this.pointToTile(coords[i][0], coords[i][1], maxZoom);
                    tileHash[this.toID(tile[0], tile[1], tile[2])] = true;
                }
            } else if (geom.type === 'LineString') {
                this.lineCover(tileHash, coords, maxZoom);

            } else if (geom.type === 'MultiLineString') {
                for (i = 0; i < coords.length; i++) {
                    this.lineCover(tileHash, coords[i], maxZoom);
                }
            } else if (geom.type === 'Polygon') {
                this.polygonCover(tileHash, tiles, coords, maxZoom);

            } else if (geom.type === 'MultiPolygon') {
                for (i = 0; i < coords.length; i++) {
                    this.polygonCover(tileHash, tiles, coords[i], maxZoom);
                }
            } else {
                throw new Error('Geometry type not implemented');
            }

            if (limits.min_zoom !== maxZoom) {
                // sync tile hash and tile array so that both contain the same tiles
                var len = tiles.length;
                this.appendHashTiles(tileHash, tiles);
                for (i = 0; i < len; i++) {
                    var t = tiles[i];
                    tileHash[this.toID(t[0], t[1], t[2])] = true;
                }
                return this.mergeTiles(tileHash, tiles, limits);
            }

            this.appendHashTiles(tileHash, tiles);
            return tiles;
        },

        mergeTiles: function (tileHash, tiles, limits) {
            var mergedTiles = [];

            for (var z = limits.max_zoom; z > limits.min_zoom; z--) {

                var parentTileHash = {};
                var parentTiles = [];

                for (var i = 0; i < tiles.length; i++) {
                    var t = tiles[i];

                    if (t[0] % 2 === 0 && t[1] % 2 === 0) {
                        var id2 = this.toID(t[0] + 1, t[1], z),
                            id3 = this.toID(t[0], t[1] + 1, z),
                            id4 = this.toID(t[0] + 1, t[1] + 1, z);

                        if (tileHash[id2] && tileHash[id3] && tileHash[id4]) {
                            tileHash[this.toID(t[0], t[1], t[2])] = false;
                            tileHash[id2] = false;
                            tileHash[id3] = false;
                            tileHash[id4] = false;

                            var parentTile = [t[0] / 2, t[1] / 2, z - 1];

                            if (z - 1 === limits.min_zoom) mergedTiles.push(parentTile);
                            else {
                                parentTileHash[this.toID(t[0] / 2, t[1] / 2, z - 1)] = true;
                                parentTiles.push(parentTile);
                            }
                        }
                    }
                }

                for (i = 0; i < tiles.length; i++) {
                    t = tiles[i];
                    if (tileHash[this.toID(t[0], t[1], t[2])]) mergedTiles.push(t);
                }

                tileHash = parentTileHash;
                tiles = parentTiles;
            }

            return mergedTiles;
        },

        polygonCover: function (tileHash, tileArray, geom, zoom) {
            var intersections = [];

            for (var i = 0; i < geom.length; i++) {
                var ring = [];
                this.lineCover(tileHash, geom[i], zoom, ring);

                for (var j = 0, len = ring.length, k = len - 1; j < len; k = j++) {
                    var m = (j + 1) % len;
                    var y = ring[j][1];

                    // add interesction if it's not local extremum or duplicate
                    if ((y > ring[k][1] || y > ring[m][1]) && // not local minimum
                        (y < ring[k][1] || y < ring[m][1]) && // not local maximum
                        y !== ring[m][1]) intersections.push(ring[j]);
                }
            }

            intersections.sort(this.compareTiles); // sort by y, then x

            for (i = 0; i < intersections.length; i += 2) {
                // fill tiles between pairs of intersections
                y = intersections[i][1];
                for (var x = intersections[i][0] + 1; x < intersections[i + 1][0]; x++) {
                    var id = this.toID(x, y, zoom);
                    if (!tileHash[id]) {
                        tileArray.push([x, y, zoom]);
                    }
                }
            }
        },

        compareTiles: function (a, b) {
            return (a[1] - b[1]) || (a[0] - b[0]);
        },

        lineCover: function (tileHash, coords, maxZoom, ring) {
            var prevX, prevY;

            for (var i = 0; i < coords.length - 1; i++) {
                var start = this.pointToTileFraction(coords[i][0], coords[i][1], maxZoom),
                    stop = this.pointToTileFraction(coords[i + 1][0], coords[i + 1][1], maxZoom),
                    x0 = start[0],
                    y0 = start[1],
                    x1 = stop[0],
                    y1 = stop[1],
                    dx = x1 - x0,
                    dy = y1 - y0;

                if (dy === 0 && dx === 0) continue;

                var sx = dx > 0 ? 1 : -1,
                    sy = dy > 0 ? 1 : -1,
                    x = Math.floor(x0),
                    y = Math.floor(y0),
                    tMaxX = dx === 0 ? Infinity : Math.abs(((dx > 0 ? 1 : 0) + x - x0) / dx),
                    tMaxY = dy === 0 ? Infinity : Math.abs(((dy > 0 ? 1 : 0) + y - y0) / dy),
                    tdx = Math.abs(sx / dx),
                    tdy = Math.abs(sy / dy);

                if (x !== prevX || y !== prevY) {
                    tileHash[this.toID(x, y, maxZoom)] = true;
                    if (ring && y !== prevY) ring.push([x, y]);
                    prevX = x;
                    prevY = y;
                }

                while (tMaxX < 1 || tMaxY < 1) {
                    if (tMaxX < tMaxY) {
                        tMaxX += tdx;
                        x += sx;
                    } else {
                        tMaxY += tdy;
                        y += sy;
                    }
                    tileHash[this.toID(x, y, maxZoom)] = true;
                    if (ring && y !== prevY) ring.push([x, y]);
                    prevX = x;
                    prevY = y;
                }
            }

            if (ring && y === ring[0][1]) ring.pop();
        },

        appendHashTiles: function (hash, tiles) {
            var keys = Object.keys(hash);
            for (var i = 0; i < keys.length; i++) {
                tiles.push(this.fromID(+keys[i]));
            }
        },

        toID: function (x, y, z) {
            var dim = 2 * (1 << z);
            return ((dim * y + x) * 32) + z;
        },

        fromID: function (id) {
            var z = id % 32,
                dim = 2 * (1 << z),
                xy = ((id - z) / 32),
                x = xy % dim,
                y = ((xy - x) / dim) % dim;
            return [x, y, z];
        },
        getTileUrlFromPoint: function (coords) {
            return L.Util.template(this._url, L.extend({
                r: this.options.detectRetina && L.Browser.retina && this.options.maxZoom > 0 ? '@2x' : '',
                s: this._getSubdomain(coords),
                x: coords.x,
                y: this.options.tms ? this._globalTileRange.max.y - coords.y : coords.y,
                z: coords.z
            }, this.options));
        },
        seedTiles: function (zooms) {
            this.stop = false;
            if (!zooms) return;
            if (!this._map) return;
            var queue = [];
            for (var z in zooms) {
                var tiles = zooms[z];
                for (var i = 0; i < tiles.length; i++) {
                    var tile = tiles[i];
                    var point = new L.Point(tile[0], tile[1]);
                    point.z = tile[2];
                    queue.push(this.getTileUrlFromPoint(point));
                }
            }

            var seedData = {
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
                queueLength: queue.length,
                errors: 0
            }
            this.fire('seedstart', seedData);
            this._seedOneTile(queue, seedData);
        },

        _stop: function () {
            this.stop = true;
        },
        _seedOneTile: function (remaining, seedData) {
            if (!remaining.length || this.stop) {
                this.fire('seedend', seedData);
                return;
            }


            var url = remaining.pop();

            this._db.get('data', url).then(function (data) {
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
                    queueLength: seedData.queueLength,
                    remainingLength: remaining.length,
                    errors: seedData.errors
                });
                this._seedOneTile(remaining, seedData);
            }.bind(this), function (err) {
                this.fire('seedprogress', {
                    queueLength: seedData.queueLength,
                    remainingLength: remaining.length,
                    errors: (err && err.exist) ? 0 : 1
                });
                this._seedOneTile(remaining, seedData);
            }.bind(this));

        }

    });
} (this, this.console, this.L, this.Promise, this.blobUtil));
