(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var formId = script.getAttribute('data-form-id');
  if (!formId) return;
  var noRedirect = script.getAttribute('data-no-redirect') === 'true';

  var containerId = 'wa-form-' + formId;
  var container = document.getElementById(containerId);
  if (!container) return;

  var scriptSrc = script.src || '';
  var apiBase = scriptSrc ? scriptSrc.replace(/\/embed\.js.*$/, '') : window.location.origin;

  var DEFAULT_STYLE = {
    labelColor: '#555555',
    labelBg: 'rgba(255,255,255,0.75)',
    inputBg: 'rgba(255,255,255,0.70)',
    inputBorder: 'rgba(255,255,255,0.85)',
    inputText: '#111111',
    inputRadius: 14,
    inputFocusBorder: '#111111',
    buttonBg: '#111111',
    buttonText: '#ffffff',
    buttonRadius: 99,
    formBg: '#EAEAEC',
    fontFamily: 'Inter, -apple-system, sans-serif',
    submitLabel: 'Send',
  };

  // Inject base structural CSS (layout only, no colours — those come from style config)
  var baseStyleId = 'wa-cf-base';
  if (!document.getElementById(baseStyleId)) {
    var baseStyle = document.createElement('style');
    baseStyle.id = baseStyleId;
    baseStyle.textContent = [
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");',
      '.wa-cf-wrap { -webkit-font-smoothing: antialiased; }',
      '.wa-cf-form { display: flex; flex-wrap: wrap; gap: 14px; }',
      '.wa-cf-field { display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; }',
      '.wa-cf-field-error { font-size: 11px; font-weight: 600; color: #E8424A; letter-spacing: 0.02em; }',
      '.wa-cf-success { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; background: rgba(76,175,125,0.08); border: 1px solid rgba(76,175,125,0.25); border-radius: 16px; color: #1f6b43; font-size: 14px; font-weight: 600; line-height: 1.5; }',
      '.wa-cf-success-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }',
      '.wa-cf-error-msg { padding: 12px 16px; background: rgba(232,66,74,0.06); border: 1px solid rgba(232,66,74,0.2); border-radius: 12px; color: #b0282e; font-size: 13px; font-weight: 500; margin-bottom: 4px; width: 100%; box-sizing: border-box; }',
    ].join('\n');
    document.head.appendChild(baseStyle);
  }

  function applyStyleConfig(s) {
    // Inject per-form scoped CSS using the style config values
    var scopeId = 'wa-cf-style-' + formId;
    var existing = document.getElementById(scopeId);
    if (existing) existing.remove();
    var el = document.createElement('style');
    el.id = scopeId;
    var scope = '#' + containerId;
    el.textContent = [
      scope + ' .wa-cf-wrap { font-family: ' + s.fontFamily + '; background: ' + s.formBg + '; }',
      scope + ' .wa-cf-form label { display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; color: ' + s.labelColor + '; letter-spacing: 0.05em; text-transform: uppercase; background: ' + s.labelBg + '; border: 1px solid rgba(228,228,232,0.9); border-radius: 99px; padding: 3px 10px; width: fit-content; margin-bottom: 0; }',
      scope + ' .wa-cf-form input, ' + scope + ' .wa-cf-form textarea, ' + scope + ' .wa-cf-form select { width: 100%; padding: 11px 16px; border: 1.5px solid ' + s.inputBorder + '; border-radius: ' + s.inputRadius + 'px; font-size: 14px; font-family: ' + s.fontFamily + '; background: ' + s.inputBg + '; color: ' + s.inputText + '; box-shadow: 0 1px 12px rgba(0,0,0,0.04); box-sizing: border-box; outline: none; -webkit-appearance: none; appearance: none; transition: border-color 0.15s, box-shadow 0.15s; }',
      scope + ' .wa-cf-form input::placeholder, ' + scope + ' .wa-cf-form textarea::placeholder { color: ' + s.inputText + '; opacity: 0.45; }',
      scope + ' .wa-cf-form input:focus, ' + scope + ' .wa-cf-form textarea:focus, ' + scope + ' .wa-cf-form select:focus { border-color: ' + s.inputFocusBorder + ' !important; box-shadow: 0 0 0 3px ' + s.inputFocusBorder + '22 !important; }',
      scope + ' .wa-cf-form textarea { min-height: 110px; resize: vertical; line-height: 1.6; }',
      scope + ' .wa-cf-submit { display: inline-flex; align-items: center; gap: 6px; background: ' + s.buttonBg + '; color: ' + s.buttonText + '; border: none; border-radius: ' + s.buttonRadius + 'px; padding: 11px 26px; font-size: 13px; font-weight: 600; font-family: ' + s.fontFamily + '; cursor: pointer; transition: opacity 0.15s; }',
      scope + ' .wa-cf-submit:hover { opacity: 0.85; }',
      scope + ' .wa-cf-submit:disabled { opacity: 0.55; cursor: not-allowed; }',
    ].join('\n');
    document.head.appendChild(el);
  }

  function renderForm(fields, errors, submitLabel, s) {
    container.className = '';
    var wrap = document.createElement('div');
    wrap.className = 'wa-cf-wrap';
    wrap.style.cssText = 'padding: 24px; font-family: ' + s.fontFamily + '; background: ' + s.formBg + ';';

    var form = document.createElement('form');
    form.className = 'wa-cf-form';

    fields.forEach(function (f) {
      if (f.type === 'hidden') {
        var hi = document.createElement('input');
        hi.type = 'hidden';
        hi.name = f.name || f.id;
        hi.value = f.defaultValue || '';
        form.appendChild(hi);
        return;
      }
      if (f.type === 'step') {
        var stepDiv = document.createElement('div');
        stepDiv.style.cssText = 'width:100%;padding:4px 6px;box-sizing:border-box;';
        stepDiv.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-top:2px solid ' + s.inputBorder + ';"><span style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:' + s.labelColor + ';">— ' + (f.label || 'Next Step') + ' —</span></div>';
        form.appendChild(stepDiv);
        return;
      }
      if (f.type === 'recaptcha' || f.type === 'recaptchav3') return; // skip in rendered form

      var widthPct = (f.width || 100) + '%';
      var wrap2 = document.createElement('div');
      wrap2.className = 'wa-cf-field';
      wrap2.style.cssText = 'width: calc(' + widthPct + ' - 7px);';

      if (f.type !== 'html' && f.type !== 'checkbox' && f.type !== 'acceptance') {
        var label = document.createElement('label');
        label.textContent = (f.label || '') + (f.required ? ' *' : '');
        wrap2.appendChild(label);
      }

      var input;
      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 5;
        input.placeholder = f.placeholder || '';
      } else if (f.type === 'select') {
        input = document.createElement('select');
        var blankOpt = document.createElement('option');
        blankOpt.value = '';
        blankOpt.textContent = '— Select —';
        input.appendChild(blankOpt);
        (f.options || '').split(',').map(function (o) { return o.trim(); }).filter(Boolean).forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          input.appendChild(o);
        });
      } else if (f.type === 'radio') {
        var radioWrap = document.createElement('div');
        radioWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        (f.options || '').split(',').map(function (o) { return o.trim(); }).filter(Boolean).forEach(function (opt) {
          var lbl = document.createElement('label');
          lbl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:' + s.inputText + ';text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
          var ri = document.createElement('input');
          ri.type = 'radio'; ri.name = f.name || f.id; ri.value = opt;
          ri.style.cssText = 'width:16px;height:16px;margin:0;accent-color:' + s.buttonBg + ';';
          if (f.required) ri.required = true;
          lbl.appendChild(ri);
          lbl.appendChild(document.createTextNode(opt));
          radioWrap.appendChild(lbl);
        });
        wrap2.appendChild(radioWrap);
        if (errors && errors[f.name || f.id]) {
          var er = document.createElement('div');
          er.className = 'wa-cf-field-error';
          er.textContent = errors[f.name || f.id];
          wrap2.appendChild(er);
        }
        form.appendChild(wrap2);
        return;
      } else if (f.type === 'checkbox') {
        var cblbl = document.createElement('label');
        cblbl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:' + s.inputText + ';text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
        var cbi = document.createElement('input');
        cbi.type = 'checkbox'; cbi.name = f.name || f.id;
        cbi.style.cssText = 'width:16px;height:16px;margin:0;accent-color:' + s.buttonBg + ';';
        if (f.required) cbi.required = true;
        cblbl.appendChild(cbi);
        cblbl.appendChild(document.createTextNode(f.placeholder || f.label || ''));
        wrap2.appendChild(cblbl);
        form.appendChild(wrap2);
        return;
      } else if (f.type === 'acceptance') {
        var aclbl = document.createElement('label');
        aclbl.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:13px;color:' + s.inputText + ';line-height:1.5;text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
        var aci = document.createElement('input');
        aci.type = 'checkbox'; aci.name = f.name || f.id;
        aci.style.cssText = 'width:16px;height:16px;margin-top:2px;flex-shrink:0;accent-color:' + s.buttonBg + ';';
        if (f.required) aci.required = true;
        aclbl.appendChild(aci);
        var acspan = document.createElement('span');
        acspan.textContent = f.placeholder || 'I agree to the terms and conditions';
        aclbl.appendChild(acspan);
        wrap2.appendChild(aclbl);
        form.appendChild(wrap2);
        return;
      } else if (f.type === 'html') {
        var htmlDiv = document.createElement('div');
        htmlDiv.style.cssText = 'font-size:14px;color:' + s.inputText + ';line-height:1.6;width:100%;';
        htmlDiv.innerHTML = f.defaultValue || '';
        wrap2.appendChild(htmlDiv);
        form.appendChild(wrap2);
        return;
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        input.placeholder = f.placeholder || '';
      }

      input.name = f.name || f.id;
      if (f.required) input.required = true;
      if (f.defaultValue) input.value = f.defaultValue;
      wrap2.appendChild(input);

      if (errors && errors[f.name || f.id]) {
        var err = document.createElement('div');
        err.className = 'wa-cf-field-error';
        err.textContent = errors[f.name || f.id];
        wrap2.appendChild(err);
      }
      form.appendChild(wrap2);
    });

    var submitRow = document.createElement('div');
    submitRow.style.cssText = 'width:100%;';
    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'wa-cf-submit';
    btn.textContent = submitLabel || s.submitLabel || 'Send';
    submitRow.appendChild(btn);
    form.appendChild(submitRow);

    wrap.appendChild(form);
    container.innerHTML = '';
    container.appendChild(wrap);
    return form;
  }

  function collectValues(formEl) {
    var values = {};
    var inputs = formEl.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(function (el) {
      if (el.type === 'checkbox') { values[el.name] = el.checked ? 'yes' : ''; }
      else if (el.type !== 'file') { values[el.name] = el.value; }
    });
    return values;
  }

  function hasFiles(formEl) {
    var fileInputs = formEl.querySelectorAll('input[type="file"][name]');
    for (var i = 0; i < fileInputs.length; i++) {
      if (fileInputs[i].files && fileInputs[i].files.length > 0) return true;
    }
    return false;
  }

  function buildFormData(formEl) {
    var fd = new FormData();
    var inputs = formEl.querySelectorAll('input[name], textarea[name], select[name]');
    inputs.forEach(function (el) {
      if (el.type === 'file') { if (el.files && el.files.length > 0) fd.append(el.name, el.files[0]); }
      else if (el.type === 'checkbox') { fd.append(el.name, el.checked ? 'yes' : ''); }
      else { fd.append(el.name, el.value); }
    });
    return fd;
  }

  function showSuccess(redirectUrl) {
    if (!noRedirect && redirectUrl && redirectUrl.trim()) { window.location.href = redirectUrl.trim(); return; }
    container.innerHTML = '<div class="wa-cf-success"><div class="wa-cf-success-icon">✓</div><div>Your message was sent successfully.<br>We\'ll be in touch soon.</div></div>';
  }

  function showError(msg) {
    var existing = container.querySelector('.wa-cf-error-msg');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.className = 'wa-cf-error-msg';
    div.textContent = msg;
    var form = container.querySelector('form');
    if (form) form.insertAdjacentElement('beforebegin', div);
    else container.insertAdjacentElement('afterbegin', div);
  }

  function makeSubmitHandler(fields, redirectUrl) {
    return function (e) {
      e.preventDefault();
      var form = e.target;
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      var useFiles = hasFiles(form);
      var fetchOpts;
      if (useFiles) {
        fetchOpts = { method: 'POST', body: buildFormData(form) };
      } else {
        fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectValues(form)) };
      }

      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/submit', fetchOpts)
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            showSuccess(redirectUrl);
          } else {
            if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
            showError(result.data.error || 'Submission failed. Please try again.');
          }
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
          showError('Network error. Please check your connection and try again.');
        });
    };
  }

  function injectOtp(formEl, s) {
    var emailInput = formEl.querySelector('input[type="email"], input[name="email"]');
    var submitBtn = formEl.querySelector('button[type="submit"], input[type="submit"]');
    if (!emailInput || !submitBtn) return;
    submitBtn.disabled = true;

    var otpReady = false;

    formEl.addEventListener('submit', function (e) {
      if (!otpReady) {
        e.preventDefault();
        e.stopImmediatePropagation();
        otpStatus.style.color = '#E8424A';
        otpStatus.textContent = otpRow.style.display === 'none'
          ? 'Please click "Send OTP" to verify your email first.'
          : 'Please enter and verify your OTP code first.';
      }
    }, true);

    var otpRow = document.createElement('div');
    otpRow.className = 'wa-cf-field';
    otpRow.style.display = 'none';
    otpRow.style.width = '100%';

    var otpLabel = document.createElement('label');
    otpLabel.textContent = 'Verification Code *';
    otpRow.appendChild(otpLabel);

    var otpInputWrap = document.createElement('div');
    otpInputWrap.style.cssText = 'display:flex;gap:8px;';

    var otpInput = document.createElement('input');
    otpInput.type = 'text';
    otpInput.name = '__otp';
    otpInput.placeholder = '6-digit code';
    otpInput.maxLength = 6;
    otpInput.style.cssText = 'flex:1;letter-spacing:0.15em;font-size:18px;text-align:center;';

    var verifyBtn = document.createElement('button');
    verifyBtn.type = 'button';
    verifyBtn.textContent = 'Verify';
    verifyBtn.style.cssText = 'background:' + s.buttonBg + ';color:' + s.buttonText + ';border:none;border-radius:' + s.buttonRadius + 'px;padding:0 20px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';

    otpInputWrap.appendChild(otpInput);
    otpInputWrap.appendChild(verifyBtn);
    otpRow.appendChild(otpInputWrap);

    var otpStatus = document.createElement('div');
    otpStatus.style.cssText = 'font-size:12px;margin-top:4px;';
    otpRow.appendChild(otpStatus);

    var emailWrap = emailInput.closest('.wa-cf-field') || emailInput.parentElement;
    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send OTP';
    sendBtn.style.cssText = 'margin-top:8px;background:' + s.buttonBg + ';color:' + s.buttonText + ';border:none;border-radius:' + s.buttonRadius + 'px;padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;';
    emailWrap.appendChild(sendBtn);

    submitBtn.parentElement.insertBefore(otpRow, submitBtn.parentElement.querySelector('.wa-cf-submit') || submitBtn);

    sendBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) { showError('Please enter your email first.'); return; }
      sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; otpReady = false;
      if (submitBtn) submitBtn.disabled = true;
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }),
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            sendBtn.textContent = 'Resend OTP'; sendBtn.disabled = false;
            otpRow.style.display = ''; otpStatus.style.color = '#555';
            otpStatus.textContent = 'Code sent to ' + email + '. Valid for 10 minutes.';
            otpInput.value = ''; if (submitBtn) submitBtn.disabled = true; otpInput.focus();
          } else {
            sendBtn.disabled = false; sendBtn.textContent = 'Send OTP';
            showError(result.data.error || 'Failed to send OTP.');
          }
        })
        .catch(function () { sendBtn.disabled = false; sendBtn.textContent = 'Send OTP'; showError('Network error. Please try again.'); });
    });

    verifyBtn.addEventListener('click', function () {
      var code = otpInput.value.trim();
      if (code.length !== 6) { otpStatus.style.color = '#E8424A'; otpStatus.textContent = 'Enter the 6-digit code.'; return; }
      verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying...';
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailInput.value.trim(), otp: code }),
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          verifyBtn.disabled = false; verifyBtn.textContent = 'Verify';
          if (result.ok) {
            otpReady = true; otpStatus.style.color = '#1f6b43';
            otpStatus.textContent = '✓ Email verified. You can now submit.';
            if (submitBtn) submitBtn.disabled = false;
          } else {
            otpStatus.style.color = '#E8424A';
            otpStatus.textContent = result.data.error || 'Invalid code. Please try again.';
          }
        })
        .catch(function () { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify'; otpStatus.style.color = '#E8424A'; otpStatus.textContent = 'Network error. Please try again.'; });
    });
  }

  // Fetch form config then render
  fetch(apiBase + '/api/public/contact-forms/forms/' + formId)
    .then(function (res) { return res.json(); })
    .then(function (form) {
      // Merge saved style_config with defaults
      var savedStyle = {};
      if (form.style_config) {
        try { savedStyle = JSON.parse(form.style_config); } catch (e) {}
      }
      var s = Object.assign({}, DEFAULT_STYLE, savedStyle);

      // Inject scoped CSS for this form's style
      applyStyleConfig(s);

      var fields = form.fields || [];
      var submitHandler = makeSubmitHandler(fields, form.redirect_url);

      if (form.template && form.template.trim()) {
        // Legacy template path — inject the style config as a <style> block
        container.className = 'wa-cf-wrap';
        container.innerHTML = form.template;
        var existingForm = container.querySelector('form');
        if (existingForm) {
          existingForm.addEventListener('submit', submitHandler);
          if (form.otp_enabled) injectOtp(existingForm, s);
        }
      } else {
        var formEl = renderForm(fields, null, s.submitLabel, s);
        formEl.addEventListener('submit', submitHandler);
        if (form.otp_enabled) injectOtp(formEl, s);
      }
    })
    .catch(function () {
      container.innerHTML = '<div class="wa-cf-error-msg">Form could not be loaded.</div>';
    });
})();
