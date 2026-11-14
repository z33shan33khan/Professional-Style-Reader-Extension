/* Ultra Pro Reader — toolbar popup. Asks the background worker to grab the
   active page / selection and hand it to the reader. */
const msgEl = document.getElementById("msg");
function say(t, err){ msgEl.textContent = t; msgEl.classList.toggle("err", !!err); }

function send(type){
  chrome.runtime.sendMessage({ type }, r => {
    if(chrome.runtime.lastError){ say(String(chrome.runtime.lastError.message || "Failed"), true); return; }
    if(r && r.ok){ window.close(); return; }
    say((r && r.error) || "Something went wrong.", true);
  });
}
document.getElementById("btnPage").onclick = () => { say("Grabbing this page…"); send("readPage"); };
document.getElementById("btnSel").onclick = () => { say("Grabbing the selection…"); send("readSelection"); };
document.getElementById("btnLib").onclick = () => send("openReader");
