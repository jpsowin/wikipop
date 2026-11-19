// Ad attribution for the email signup forms.
// 1. Remembers utm_* / fbclid from the landing URL for this visit.
// 2. On subscribe, passes them to Buttondown as subscriber metadata, so we
//    can count signups per ad without any cookies or third-party tools.
// 3. If a Meta Pixel ID is set below, loads the pixel and sends a Lead event.
(function () {
  var META_PIXEL_ID = "1161404729728089"; // "Wikipop Website" dataset, Josh Business

  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid"];
  var store = {};
  try { store = JSON.parse(sessionStorage.getItem("wp_attr") || "{}"); } catch (e) {}
  var params = new URLSearchParams(location.search);
  var fresh = false;
  KEYS.forEach(function (k) { if (params.get(k)) { store[k] = params.get(k).slice(0, 120); fresh = true; } });
  if (fresh) { store.landing = location.pathname; }
  try { sessionStorage.setItem("wp_attr", JSON.stringify(store)); } catch (e) {}

  if (META_PIXEL_ID) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq("init", META_PIXEL_ID);
    fbq("track", "PageView");
  }

  function addHidden(form, name, value) {
    var old = form.querySelector('input[name="' + name + '"]');
    if (old) old.remove();
    var input = document.createElement("input");
    input.type = "hidden"; input.name = name; input.value = value;
    form.appendChild(input);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".slanted-form").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        Object.keys(store).forEach(function (k) { addHidden(form, "metadata__" + k, store[k]); });
        if (form.dataset.placement) addHidden(form, "metadata__placement", form.dataset.placement);
        if (window.fbq && META_PIXEL_ID && !form.dataset.sent) {
          ev.preventDefault();
          form.dataset.sent = "1";
          fbq("track", "Lead", { content_name: form.dataset.placement || "signup" });
          setTimeout(function () { form.submit(); }, 400);
        }
      });
    });
  });
})();
