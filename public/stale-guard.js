// A page served from an old cached copy after a deploy points at /assets/ files that no longer exist, so the app
// never starts: a blank page. In-app wallet browsers (MetaMask on Android) do this on refresh. When an app file
// fails to load, fetch a fresh copy of the page once, with a query the cache has never seen. The timestamp stops a
// loop if the file is missing for some other reason.
;(function () {
  var KEY = 'r3os.freshReloadAt'
  function freshReload() {
    try {
      var last = Number(sessionStorage.getItem(KEY)) || 0
      if (Date.now() - last < 60000) return false
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch (error) {
      return false
    }
    var url = new URL(location.href)
    url.searchParams.set('fresh', String(Date.now()))
    location.replace(url.toString())
    return true
  }
  window.__r3osFreshReload = freshReload
  window.addEventListener(
    'error',
    function (event) {
      var el = event.target
      if (!el || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return
      var src = el.src || el.href || ''
      if (src.indexOf('/assets/') !== -1) freshReload()
    },
    true,
  )
})()
