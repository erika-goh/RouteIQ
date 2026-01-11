let map, directionsService, directionsRenderer, geocoder, trafficLayer;
let currentLocation = null;
let destinationLocation = null;
let originLocationFromStation = null;
let activeRouteIndex = null;
let mapReady = false;
let userMarker, destinationMarker;
let defaultBounds = null;
let originPlace = null;
let destinationPlace = null;
let selectedBusTime = null;
let currentBusSchedule = [];

const routes = [];
const userIncidents = [];
