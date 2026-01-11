let lifetimeStats = {
    trips: parseInt(localStorage.getItem('gobus_trips')) || 0,
    timeSaved: parseInt(localStorage.getItem('gobus_timeSaved')) || 0,
    co2Saved: parseFloat(localStorage.getItem('gobus_co2Saved')) || 0,
    reroutes: parseInt(localStorage.getItem('gobus_reroutes')) || 0
};

function saveStats() 
function updateStatsDisplay() 

/* default arrival time */
const now = new Date();
now.setMinutes(now.getMinutes() + 30);
document.getElementById('arrival-time').value = now.toTimeString().substring(0, 5);

updateStatsDisplay();
