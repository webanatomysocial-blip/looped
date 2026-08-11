(function () {
  var scriptEl = document.currentScript;
  var formId = scriptEl.getAttribute("data-form-id");
  var origin = new URL(scriptEl.src).origin;
  var apiBase = origin + "/api/public/contact-forms";

  var mountEl = document.getElementById("wa-form-" + formId) || document.createElement("div");
  if (!mountEl.isConnected) {
    scriptEl.parentNode.insertBefore(mountEl, scriptEl);
  }
  mountEl.textContent = "Loading form...";

  if (!document.getElementById("wa-contact-form-style")) {
    var style = document.createElement("style");
    style.id = "wa-contact-form-style";
    style.textContent =
      ".wa-contact-form{max-width:400px;display:flex;flex-direction:column;gap:12px;font-family:sans-serif}" +
      ".wa-contact-form input,.wa-contact-form textarea{padding:8px;font:inherit}" +
      ".wa-contact-form button{padding:8px;cursor:pointer}" +
      ".wa-contact-form button[disabled]{opacity:.6;cursor:not-allowed}";
    document.head.appendChild(style);
  }

  fetch(apiBase + "/forms/" + formId)
    .then(function (res) {
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then(function (form) {
      if (form.template && form.template.trim()) {
        renderTemplate(form.template);
      } else {
        renderGenerated(form.fields);
      }
    })
    .catch(function () {
      mountEl.textContent = "Unable to load form.";
    });

  function renderGenerated(fields) {
    var inputsHtml = fields
      .map(function (field) {
        var required = field.required ? "required" : "";
        if (field.type === "textarea") {
          return (
            '<textarea name="' + field.name + '" rows="5" placeholder="' + field.label + '" ' + required + "></textarea>"
          );
        }
        return (
          '<input name="' + field.name + '" type="' + field.type + '" placeholder="' + field.label + '" ' + required + ">"
        );
      })
      .join("");

    mountEl.innerHTML =
      '<form class="wa-contact-form">' +
      inputsHtml +
      '<button type="submit">Send</button>' +
      '<p class="wa-contact-status"></p>' +
      "</form>";

    wireSubmit();
  }

  function renderTemplate(html) {
    mountEl.innerHTML = html;
    if (!mountEl.querySelector(".wa-contact-status")) {
      var status = document.createElement("p");
      status.className = "wa-contact-status";
      mountEl.appendChild(status);
    }
    wireSubmit();
  }

  function wireSubmit() {
    var form = mountEl.querySelector("form");
    if (!form) return;
    var status = mountEl.querySelector(".wa-contact-status");
    var button = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (button) button.disabled = true;
      if (status) status.textContent = "Sending...";

      var payload = {};
      Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (el) {
        payload[el.name] = el.value;
      });

      fetch(apiBase + "/forms/" + formId + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) {
            return res
              .json()
              .catch(function () {
                return {};
              })
              .then(function (body) {
                throw new Error(body.error || "Something went wrong. Try again.");
              });
          }
          if (status) status.textContent = "Message sent!";
          form.reset();
        })
        .catch(function (err) {
          if (status) status.textContent = err.message || "Something went wrong. Try again.";
        })
        .finally(function () {
          if (button) button.disabled = false;
        });
    });
  }
})();
