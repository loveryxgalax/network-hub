// Kade Cloud shows every date and time in Kenya time (East Africa Time, UTC+3), whatever time zone the viewer's
// device is set to. Formatting that already names a time zone (e.g. UTC for date-only values) is left as it is.
(function(){var Z='Africa/Nairobi',P=Date.prototype;['toLocaleString','toLocaleDateString','toLocaleTimeString'].forEach(function(k){var f=P[k];P[k]=function(l,o){if(o&&o.timeZone)return f.call(this,l,o);var x={};if(o)for(var i in o)x[i]=o[i];x.timeZone=Z;try{return f.call(this,l,x);}catch(e){return f.call(this,l,o);}};});})();
