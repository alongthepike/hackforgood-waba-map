var fs = require('fs');
var path = require('path');
var request = require('request');

var montgomery = { name: 'Montgomery County, MD', url: 'https://data.montgomerycountymd.gov/api/geospatial/icc2-ppee?method=export&format=GeoJSON', type: 'geojson', filename: 'MD_MontgomeryCounty.geojson', mappingFunction: mocoMap, done: false };
var arlington = { name: 'Arlington County, VA', url: 'https://opendata.arcgis.com/datasets/3e76860e343a4462b2d724e4458c5b1d_0.geojson', type: 'geojson', filename: 'VA_Arlington.geojson', mappingFunction: arlingtonMap, done: false };
var alexandria = { name: 'Alexandria, VA', url: 'http://data.alexgis.opendata.arcgis.com/datasets/685dfe61f1aa477f8cbd21dceb5ba9b5_0.geojson', type: 'geojson', filename: 'VA_Alexandria.geojson', mappingFunction: alexandriaMap, done: false };
var dcLanes = { name: 'Washington, DC Bike Lanes', url: 'http://opendata.dc.gov/datasets/294e062cdf2c48d5b9cbc374d9709bc0_2.geojson', type: 'geojson', filename: 'DC_Washington_BikeLanes.geojson', mappingFunction: dcLanesMap, done: false, onDone: combineDC };
var dcTrails = { name: 'Washington, DC Trails', url: 'http://opendata.dc.gov/datasets/e8c2b7ef54fb43d9a2ed1b0b75d0a14d_4.geojson', type: 'geojson', filename: 'DC_Washington_Trails.geojson', mappingFunction: dcTrailsMap, done: false, onDone: combineDC };
var princeGeorges = { name: 'Prince George\'s County, MD', url: 'http://gisdata.pgplanning.org/opendata/downloadzip.asp?FileName=/data/ShapeFile/Master_Plan_Trail_Ln.zip', type: 'shapefile', filename: 'MD_PrinceGeorgesCounty.geojson', mappingFunction: pgMap, done: false };
//var fairfaxLanes = { name: 'Fairfax County, VA Bike Lanes', url: 'http://data.fairfaxcountygis.opendata.arcgis.com/datasets/0dacd6f1e697469a81d6f7292a78d30e_16.geojson', type: 'geojson', filename: 'VA_Fairfax_BikeLanes.geojson', mappingFunction: fairfaxLanesMap, done: false, onDone: combineFairfax };
var fairfaxLanes = { name: 'Fairfax County, VA Bike Lanes', url: 'http://dcbikemap.com/data/Fairfax_Bike_Infrastructure.zip', type: 'shapefile', filename: 'VA_Fairfax_BikeLanes.geojson', mappingFunction: fairfaxLanesMap, done: false, onDone: combineFairfax };
var fairfaxCountyTrails = { name: 'Fairfax County, VA County Trails', url: 'http://data.fairfaxcountygis.opendata.arcgis.com/datasets/8a08319c7cb449b9a9329709f8dfdb30_3.geojson', type: 'geojson', filename: 'VA_Fairfax_CountyTrails.geojson', mappingFunction: fairfaxCountyTrailsMap, done: false, onDone: combineFairfax };
var fairfaxNonCountyTrails = { name: 'Fairfax County, VA Non-County Trails', url: 'http://data.fairfaxcountygis.opendata.arcgis.com/datasets/ffa1a86b009c4528899c7e0ae50b5e5b_4.geojson', type: 'geojson', filename: 'VA_Fairfax_NonCountyTrails.geojson', mappingFunction: fairfaxNonCountyTrailsMap, done: false, onDone: combineFairfax };

function fetch(locality) {
    console.log('fetching file for ' + locality.name);
    if (locality.type == 'shapefile') {
        request({
            url: locality.url,
            encoding: null
        }, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                fs.writeFileSync(path.resolve('working', locality.filename + '.zip'), body);
                console.log('Converting Shapefile to GeoJson for ' + locality.name);
                var formData = { upload: fs.createReadStream(path.resolve('working', locality.filename + '.zip')), targetSrs: 'EPSG:4326' };
                request.post({
                    url: 'http://ogre.adc4gis.com/convert',
                    formData: formData
                }, function (error, response, body) {
                    fs.unlinkSync(path.resolve('working', locality.filename + '.zip'));
                    if (!error && response.statusCode === 200) {
                        mapFilterSave(JSON.parse(body), locality);
                    } else {
                        console.log('ERROR: ' + error);
                    }
                });
            } else {
                console.log('ERROR: ' + error);
            }
        })
    }
    else {
        request({
            url: locality.url,
            json: true
        }, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                mapFilterSave(body, locality);
            } else {
                console.log('ERROR: ' + error);
            }
        })
    }

}

function mapFilterSave(geoJson, locality) {
	//save raw files
	fs.writeFileSync(path.resolve('rawfacilities', locality.filename), JSON.stringify(geoJson));

    //each locality has their own labeling & categorizing system.  Normalize them.
    console.log('mapping raw file for ' + locality.name);
    console.log('# of raw features: ' + geoJson.features.length);
    var mappedGeoJson = locality.mappingFunction(geoJson);

    console.log('writing mapped file for ' + locality.name);
    fs.writeFileSync(path.resolve('mappedfacilities', locality.filename), JSON.stringify(mappedGeoJson));


    //filter it so we don't have sharrows and wide shoulders and other things WABA doesn't consider infrastructure
    console.log('filtering mapped file for ' + locality.name);
    mappedGeoJson.features = mappedGeoJson.features.filter(isRealBikeFacility);

    console.log('writing finalized file to disk for ' + locality.name);
    //write to disk
    fs.writeFileSync(path.resolve('filteredfacilities', locality.filename), JSON.stringify(mappedGeoJson));
    locality.done = true;
    if (locality.onDone) locality.onDone();
}

function mocoMap(rawGeoJson) {
    //keep objectid
    //keep name
    //convert category = 'Paved Off-Road Trail' to wabaclassification = 'Paved Trail'
    //convert category = 'Bike Lanes' to wabaclassification = 'Bike Lane'
    //convert category = 'Bike-Friendly Shoulders' to wabaclassification = 'Shoulder'
    //convert category = 'Signed On-Road Route' to wabaclassification = 'Signed Route'
    //convert category = 'Natural Surface' to wabaclassification = 'Unpaved Trail'
    //convert category = 'Separated Bike Lanes' to wabaclassification = 'Separated Bike Lanes'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.objectid, name: rawFeature.properties.name }, geometry: rawFeature.geometry };
        if (rawFeature.properties.category == 'Paved Off-Road Trail') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.category == 'Bike Lanes') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.category == 'Bike-Friendly Shoulders') mappedFeature.properties.wabaclassification = 'Shoulder';
        if (rawFeature.properties.category == 'Signed On-Road Route') mappedFeature.properties.wabaclassification = 'Signed Route';
        if (rawFeature.properties.category == 'Natural Surface') mappedFeature.properties.wabaclassification = 'Unpaved Trail';
        if (rawFeature.properties.category == 'Separated Bike Lanes') mappedFeature.properties.wabaclassification = 'Separated Bike Lane';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function arlingtonMap(rawGeoJson) {
    //convert OBJECTID to objectid
    //convert Label to name
    //convert Route_Type = 'Off Street Trail' to wabaclassification = 'Paved Trail'
    //convert Route_Type = 'Bicycle Lane' to wabaclassification = 'Bike Lane'
    //convert Route_Type = 'Sharrow' to wabaclassification = 'Sharrows'
    //convert Route_Type = 'Recommended Route' to wabaclassification = 'Signed Route'
    //convert Route_Type = 'Protected Bike Lane' to wabaclassification = 'Separated Bike Lane'
    //convert Route_Type = 'Buffered Bike Lane' to wabaclassification = 'Buffered Bike Lane'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.OBJECTID, name: rawFeature.properties.Label }, geometry: rawFeature.geometry };
        if (rawFeature.properties.Route_Type == 'Off Street Trail') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.Route_Type == 'Bicycle Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.Route_Type == 'Sharrow') mappedFeature.properties.wabaclassification = 'Sharrows';
        if (rawFeature.properties.Route_Type == 'Recommended Route') mappedFeature.properties.wabaclassification = 'Signed Route';
        if (rawFeature.properties.Route_Type == 'Protected Bike Lane') mappedFeature.properties.wabaclassification = 'Separated Bike Lane';
		if (rawFeature.properties.Route_Type == 'Buffered Bike Lane') mappedFeature.properties.wabaclassification = 'Buffered Bike Lane';


        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function alexandriaMap(rawGeoJson) {
    //filter to STATUS = 'Existing'
    //convert FID to objectid
    //convert TRAILTYPE = 'Off Street' to wabaclassification = 'Paved Trail'
    //convert TRAILTYPE = 'On Street' and SHARROW = 'No' to wabaclassification = 'Bike Lane'
    //convert TRAILTYPE = 'On Street' and SHARROW = 'Yes' to wabaclassification = 'Sharrows'

    var geojson = { type: 'FeatureCollection', features: [] };
    rawGeoJson.features = rawGeoJson.features.filter(function (value) { return value.properties.STATUS == 'Existing'; })

    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.FID }, geometry: rawFeature.geometry };
        if (rawFeature.properties.TRAILTYPE == 'Off Street') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.TRAILTYPE == 'On Street' && rawFeature.properties.SHARROW == 'No') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.TRAILTYPE == 'On Street' && rawFeature.properties.SHARROW == 'Yes') mappedFeature.properties.wabaclassification = 'Sharrows';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function dcLanesMap(rawGeoJson) {
    //convert OBJECTID to objectid
    //convert FACILITY = 'Bus/Bike Lane' to wabaclassification = 'Bus/Bike Lane'
    //convert FACILITY = 'Existing Bike Lane' to wabaclassification = 'Bike Lane'
    //convert FACILITY = 'Cycle Track' to wabaclassification = 'Separated Bike Lane'
    //convert FACILITY = 'Shared Lane' to wabaclassification = 'Sharrows'
    //convert FACILITY = 'Contraflow Bike Lane' to wabaclassification = 'Bike Lane'
    //convert FACILITY = 'Climbing Lane' to wabaclassification = 'Bike Lane'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.OBJECTID }, geometry: rawFeature.geometry };
        if (rawFeature.properties.FACILITY == 'Bus/Bike Lane') mappedFeature.properties.wabaclassification = 'Bus/Bike Lane';
        if (rawFeature.properties.FACILITY == 'Existing Bike Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.FACILITY == 'Climbing Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.FACILITY == 'Shared Lane') mappedFeature.properties.wabaclassification = 'Sharrows';
        if (rawFeature.properties.FACILITY == 'Contraflow Bike Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.FACILITY == 'Cycle Track') mappedFeature.properties.wabaclassification = 'Separated Bike Lane';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function dcTrailsMap(rawGeoJson) {
    //convert OBJECTID to objectid
    //convert NAME to name
    //set all to wabaclassification = 'Paved Trail'
    //except for
    // * ft circle trail - unpaved
    // * C&O Canal Towpath - unpaved
    // * Kingman Island Trail - unpaved. not even sure bikes are allowed
    // * Texas Ave - that's not even Tx Ave, it's Ft Davis Dr, and it has no bike facilities

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.OBJECTID, name: rawFeature.properties.NAME }, geometry: rawFeature.geometry };

        if (mappedFeature.properties.name == 'Ft. Circle Trail') mappedFeature.properties.wabaclassification = 'Unpaved Trail';
        else if (mappedFeature.properties.name == 'Kingman Island Trail') mappedFeature.properties.wabaclassification = 'Unpaved Trail';
        else if (mappedFeature.properties.name == 'C&O Canal Towpath') mappedFeature.properties.wabaclassification = 'Unpaved Trail';
        else if (mappedFeature.properties.name == 'Texas Ave') mappedFeature.properties.wabaclassification = null;
        else mappedFeature.properties.wabaclassification = 'Paved Trail';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function pgMap(rawGeoJson) {
    //filter to FACILITY_S = 'Existing'
    //convert FACILITY_N to name
    //convert FACILITY_T = 'Hard Surface Trail' to wabaclassification = 'Paved Trail'
    //convert FACILITY_T = 'Shared Roadway' to wabaclassification = 'Sharrows'
    //convert FACILITY_T = 'Bike Lane' to wabaclassification = 'Bike Lane'

    var geojson = { type: 'FeatureCollection', features: [] };
    rawGeoJson.features = rawGeoJson.features.filter(function (value) { return value.properties.FACILITY_S == 'Existing'; })

    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: i }, geometry: rawFeature.geometry };
        if (rawFeature.properties.FACILITY_T == 'Hard Surface Trail') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.FACILITY_T == 'Shared Roadway') mappedFeature.properties.wabaclassification = 'Sharrows';
        if (rawFeature.properties.FACILITY_T == 'Bike Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.FACILITY_T == 'Natural Surface Trail') mappedFeature.properties.wabaclassification = 'Unpaved Trail';
        if (rawFeature.properties.FACILITY_T == 'Sidepath') mappedFeature.properties.wabaclassification = 'Sidewalk';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function fairfaxLanesMap(rawGeoJson) {
    //convert OBJECTID to objectid
    //convert LABEL to name
    //convert STATUS = 'Bike Lane' to wabaclassification = 'Bike Lane'
    //convert STATUS = 'Corridor Caution' to wabaclassification = 'Death Trap'
    //convert STATUS = 'Preferred' to wabaclassification = 'Signed Route'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.Name, name: rawFeature.properties.Name }, geometry: rawFeature.geometry };
        if (rawFeature.properties.Type == 'Bike Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.Type == 'Buffered Bike Lane') mappedFeature.properties.wabaclassification = 'Buffered Bike Lane';
        if (rawFeature.properties.Type == 'Climbing Lane') mappedFeature.properties.wabaclassification = 'Bike Lane';
        if (rawFeature.properties.Type == 'Sharrow') mappedFeature.properties.wabaclassification = 'Sharrows';
        if (rawFeature.properties.Type == 'Sharrows') mappedFeature.properties.wabaclassification = 'Sharrows';
        if (rawFeature.properties.Type == 'Sharrowsq') mappedFeature.properties.wabaclassification = 'Sharrows';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function fairfaxCountyTrailsMap(rawGeoJson) {
    //convert ID to objectid
    //convert TRAIL_NAME to name
    //convert SURFACE_MATERIAL = 'Asphalt' to wabaclassification = 'Paved Trail'
    //convert SURFACE_MATERIAL = 'Concrete' to wabaclassification = 'Paved Trap'
    //convert any other to wabaclassification = 'Unpaved Trail'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.ID, name: rawFeature.properties.TRAIL_NAME }, geometry: rawFeature.geometry };
        if (rawFeature.properties.SURFACE_MATERIAL == 'Asphalt') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.SURFACE_MATERIAL == 'Concrete') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.SURFACE_MATERIAL != 'Asphalt' && rawFeature.properties.SURFACE_MATERIAL != 'Concrete') mappedFeature.properties.wabaclassification = 'Unpaved Trail';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function fairfaxNonCountyTrailsMap(rawGeoJson) {
    //convert OBJECTID to objectid
    //convert TRAIL_NAME to name
    //convert SURFACE_MATERIAL = 'Asphalt' to wabaclassification = 'Paved Trail'
    //convert SURFACE_MATERIAL = 'Concrete' to wabaclassification = 'Paved Trap'
    //convert any other to wabaclassification = 'Unpaved Trail'

    var geojson = { type: 'FeatureCollection', features: [] };
    for (var i = 0; i < rawGeoJson.features.length; i++) {
        var rawFeature = rawGeoJson.features[i];
        var mappedFeature = { type: 'Feature', properties: { objectid: rawFeature.properties.OBJECTID, name: rawFeature.properties.TRAIL_NAME }, geometry: rawFeature.geometry };
        if (rawFeature.properties.SURFACE_MATERIAL == 'Asphalt') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.SURFACE_MATERIAL == 'Concrete') mappedFeature.properties.wabaclassification = 'Paved Trail';
        if (rawFeature.properties.SURFACE_MATERIAL != 'Asphalt' && rawFeature.properties.SURFACE_MATERIAL != 'Concrete') mappedFeature.properties.wabaclassification = 'Unpaved Trail';

        geojson.features.push(mappedFeature);
    }

    return geojson;
}

function isRealBikeFacility(value) {
    return (value.properties.wabaclassification == 'Paved Trail' || value.properties.wabaclassification == 'Bike Lane' || value.properties.wabaclassification == 'Buffered Bike Lane' || value.properties.wabaclassification == 'Separated Bike Lane');
}

function combineDC() {
    if (dcLanes.done && dcTrails.done) {
        console.log('Combining mapped DC Trails geojson with DC Lanes geojson');
        var lanes = JSON.parse(fs.readFileSync(path.resolve('mappedfacilities', dcLanes.filename), 'utf8'));
        var trails = JSON.parse(fs.readFileSync(path.resolve('mappedfacilities', dcTrails.filename), 'utf8'));
        lanes.features = lanes.features.concat(trails.features);

        fs.writeFileSync(path.resolve('mappedfacilities', 'DC_Washington.geojson'), JSON.stringify(lanes));
        fs.unlinkSync(path.resolve('mappedfacilities', dcLanes.filename));
        fs.unlinkSync(path.resolve('mappedfacilities', dcTrails.filename));

        console.log('Combining filtered DC Trails geojson with DC Lanes geojson');
		var lanes = JSON.parse(fs.readFileSync(path.resolve('filteredfacilities', dcLanes.filename), 'utf8'));
		var trails = JSON.parse(fs.readFileSync(path.resolve('filteredfacilities', dcTrails.filename), 'utf8'));
		lanes.features = lanes.features.concat(trails.features);

		fs.writeFileSync(path.resolve('filteredfacilities', 'DC_Washington.geojson'), JSON.stringify(lanes));
		fs.unlinkSync(path.resolve('filteredfacilities', dcLanes.filename));
        fs.unlinkSync(path.resolve('filteredfacilities', dcTrails.filename));
    }

}

function combineFairfax() {
    if (fairfaxLanes.done && fairfaxCountyTrails.done && fairfaxNonCountyTrails.done) {
        console.log('Combining mapped Fairfax County Lanes, County Trails and Non-County Trails geojson');
        var lanes = JSON.parse(fs.readFileSync(path.resolve('mappedfacilities', fairfaxLanes.filename), 'utf8'));
        var countyTrails = JSON.parse(fs.readFileSync(path.resolve('mappedfacilities', fairfaxCountyTrails.filename), 'utf8'));
        var nonCountyTrails = JSON.parse(fs.readFileSync(path.resolve('mappedfacilities', fairfaxNonCountyTrails.filename), 'utf8'));
        lanes.features = lanes.features.concat(countyTrails.features);
        lanes.features = lanes.features.concat(nonCountyTrails.features);

        fs.writeFileSync(path.resolve('mappedfacilities', 'VA_Fairfax.geojson'), JSON.stringify(lanes));
        fs.unlinkSync(path.resolve('mappedfacilities', fairfaxLanes.filename));
        fs.unlinkSync(path.resolve('mappedfacilities', fairfaxCountyTrails.filename));
        fs.unlinkSync(path.resolve('mappedfacilities', fairfaxNonCountyTrails.filename));

        console.log('Combining filtered Fairfax County Lanes, County Trails and Non-County Trails geojson');
		var lanes = JSON.parse(fs.readFileSync(path.resolve('filteredfacilities', fairfaxLanes.filename), 'utf8'));
		var countyTrails = JSON.parse(fs.readFileSync(path.resolve('filteredfacilities', fairfaxCountyTrails.filename), 'utf8'));
		var nonCountyTrails = JSON.parse(fs.readFileSync(path.resolve('filteredfacilities', fairfaxNonCountyTrails.filename), 'utf8'));
		lanes.features = lanes.features.concat(countyTrails.features);
		lanes.features = lanes.features.concat(nonCountyTrails.features);

		fs.writeFileSync(path.resolve('filteredfacilities', 'VA_Fairfax.geojson'), JSON.stringify(lanes));
		fs.unlinkSync(path.resolve('filteredfacilities', fairfaxLanes.filename));
		fs.unlinkSync(path.resolve('filteredfacilities', fairfaxCountyTrails.filename));
        fs.unlinkSync(path.resolve('filteredfacilities', fairfaxNonCountyTrails.filename));
    }

}

fetch(montgomery);
fetch(arlington);
fetch(alexandria);
fetch(dcLanes);
fetch(dcTrails);
fetch(princeGeorges);
fetch(fairfaxLanes);
fetch(fairfaxCountyTrails);
fetch(fairfaxNonCountyTrails);

