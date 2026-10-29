(()=>{'use strict';const q=new URLSearchParams(location.search),id=q.get('closeout');location.replace('/daily-close?'+(id?'legacyCloseout='+encodeURIComponent(id):'recordType=temporary'));})();
