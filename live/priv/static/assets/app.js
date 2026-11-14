// Connects the live view over the websocket at /live/live (the hub checks the netops sign-in first).
window.addEventListener('DOMContentLoaded',()=>{
  const csrf=document.querySelector("meta[name='csrf-token']").getAttribute('content');
  const liveSocket=new LiveView.LiveSocket('/live/live',Phoenix.Socket,{params:{_csrf_token:csrf}});
  liveSocket.connect();window.liveSocket=liveSocket;
});
