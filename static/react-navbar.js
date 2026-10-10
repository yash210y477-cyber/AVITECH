
(function () {
  function Navbar() {
    const path = window.location.pathname;
    const testPaths = ["/learning", "/quiz", "/theory", "/instructions", "/it", "/aviation",
      "/it-topic", "/aviation-topic", "/result"];
    const active = path === "/progress" ? "progress" : (path === "/" ? "home" : (path === "/admin" ? "admin" : "test"));

    const links = [
      { key: "home", label: "Home", href: "/" },
      { key: "test", label: "Test", href: "/learning" },
      { key: "progress", label: "Progress", href: "/progress" }
    ];

    const [mobileOpen, setMobileOpen] = React.useState(false);

    return React.createElement(
      "header",
      { className: "av-navbar" },
      React.createElement(
        "div",
        { className: "av-nav-shell" },
        React.createElement(
          "a",
          { className: "av-brand", href: "/" },
          React.createElement("span", { className: "av-brand-mark" },
            React.createElement("span", { className: "av-mark-a" }, "A"),
            React.createElement("span", { className: "av-mark-orbit" })
          ),
          React.createElement(
            "span",
            { className: "av-brand-copy" },
            React.createElement("strong", null, "AVITECH"),
            React.createElement("small", null, "AI LEARNING PLATFORM")
          )
        ),

        React.createElement(
          "nav",
          { className: "av-nav-links" },
          links.map(function (link) {
            return React.createElement(
              "a",
              {
                key: link.key,
                href: link.href,
                className: "av-nav-link " + (active === link.key ? "is-active" : "")
              },
              link.label
            );
          })
        ),

        React.createElement(
          "div",
          { className: "av-nav-actions" },
          React.createElement(
            "span",
            { className: "av-user-name", id: "av-user-name" },
            "Login"
          ),
          React.createElement(
            "a",
            { className: "av-avatar", href: "/login", "aria-label": "Login", id: "av-avatar" },
            "L"
          ),
          React.createElement(
            "a",
            { className: "av-logout", href: "/logout", "aria-label": "Logout", id: "av-logout", style: { display: "none" } },
            "Logout"
          )
        ),

        React.createElement(
          "button",
          {
            className: "av-menu",
            type: "button",
            "aria-label": "Toggle navigation",
            onClick: function () { setMobileOpen(!mobileOpen); }
          },
          mobileOpen ? "×" : "☰"
        )
      ),

      mobileOpen && React.createElement(
        "div",
        { className: "av-mobile-menu" },
        links.map(function (link) {
          return React.createElement(
            "a",
            {
              key: link.key,
              href: link.href,
              className: active === link.key ? "is-active" : "",
              onClick: function () { setMobileOpen(false); }
            },
            link.label
          );
        }),
        React.createElement(
          "a",
          { href: "/logout", onClick: function () { setMobileOpen(false); } },
          "Logout"
        )
      )
    );
  }

  function mount() {
    const root = document.getElementById("react-navbar");
    if (!root || !window.React || !window.ReactDOM) return;
    ReactDOM.createRoot(root).render(React.createElement(Navbar));

    fetch("/api/my-profile", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !data.user) return;
        var name = String(data.user.name || "User");
        var nameEl = document.getElementById("av-user-name");
        var avatarEl = document.getElementById("av-avatar");
        if (nameEl) nameEl.textContent = name;
        if (avatarEl) {
          avatarEl.textContent = name.trim().charAt(0).toUpperCase() || "U";
          avatarEl.href = "/progress";
          avatarEl.setAttribute("aria-label", "Open your progress");
        }
        var logoutEl = document.getElementById("av-logout");
        if (logoutEl) logoutEl.style.display = "inline-flex";
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
