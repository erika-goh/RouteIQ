# RouteIQ

RouteIQ is an intelligent, real-time transit planning web application designed to help commuters across the Greater Toronto and Hamilton Area plan faster, more reliable, and more sustainable trips using GO Bus and multimodal transportation.

Built using HTML, CSS, and JavaScript and powered by the Google Maps API, RouteIQ combines live routing, traffic awareness, transit scheduling, and sustainability insights into a single interactive dashboard.

---

## Overview

Commuters often know how long a trip takes but not when they should leave to arrive on time. RouteIQ focuses on departure-time intelligence by factoring in live traffic conditions, transit schedules, and routing alternatives to recommend optimal leave times.

The application compares transit, driving, and cycling routes in real time while providing actionable alerts and environmental impact tracking.

---

## Features

### Smart Trip Planning
- Plan trips from:
  - Current GPS location
  - GO Bus or GO Train stations
  - Custom addresses
- Supports both “Arrive By” and “Catch Specific Bus” travel modes
- Automatically calculates recommended departure times

### Live Map and Routing
- Real-time route visualization using Google Maps
- Traffic-aware driving routes with live congestion data
- Side-by-side comparison of transit, driving, and cycling options

### Transit Scheduling Logic
- Simulated GO Transit bus schedules with an API-ready design
- Displays upcoming departures and time remaining
- Provides warnings for missed or imminent buses

### Intelligent Alerts
- Dynamic alerts for traffic delays and tight departure windows
- Highlights faster or more reliable alternatives based on live data

### Sustainability Metrics
- Tracks long-term commuter impact using local storage:
  - Number of transit and cycling trips
  - Time saved compared to driving
  - Estimated CO₂ emissions reduced
  - Traffic reroutes avoided

### Community Incident Reporting
- Users can report traffic incidents, construction, delays, or hazards
- Reports help inform routing decisions for other commuters

---

## Technology Stack

### Frontend
- HTML5
- CSS3 (custom dark UI system)
- Vanilla JavaScript

### APIs and Services
- Google Maps JavaScript API
- Google Directions API
- Google Places Autocomplete
- Google Traffic Layer

### Data Management
- LocalStorage for persistent user statistics
- Modular structure designed for future API integration

## Future Enhancements

- Live GO Transit API integration
- Real-time vehicle tracking
- User accounts with cloud-synced statistics
- Progressive Web App (PWA) support
- Accessibility improvements

---

## Disclaimer

This project is a proof of concept and is not affiliated with Metrolinx or GO Transit. Transit schedules are simulated for demonstration purposes only.

---
