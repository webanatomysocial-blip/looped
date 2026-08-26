(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var candidates = document.querySelectorAll('script[data-form-id][src*="embed.js"]');
    if (candidates.length) return candidates[candidates.length - 1];
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var scriptSrc = (script && script.src) ? script.src : '';
  var apiBase = scriptSrc ? scriptSrc.replace(/\/embed\.js.*$/, '') : window.location.origin;
  var globalNoRedirect = script ? script.getAttribute('data-no-redirect') === 'true' : false;

  function tryInit(container) {
    var id = container.id; // e.g. "wa-form-5"
    if (!id) return;
    var formId = id.replace('wa-form-', '');
    if (!formId || isNaN(Number(formId))) return;
    // Skip if already rendered (check for our wrapper, not a stale ID map)
    if (container.querySelector('.wa-cf-wrap')) return;
    bootstrap(container, formId, globalNoRedirect);
  }

  function scanAndInit() {
    var containers = document.querySelectorAll('[id^="wa-form-"]');
    for (var i = 0; i < containers.length; i++) tryInit(containers[i]);
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndInit);
  } else {
    scanAndInit();
  }

  // Watch for AJAX navigation injecting containers later
  if (window.MutationObserver) {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType !== 1) continue;
          // Check the node itself
          if (node.id && node.id.indexOf('wa-form-') === 0) tryInit(node);
          // Check descendants
          var children = node.querySelectorAll ? node.querySelectorAll('[id^="wa-form-"]') : [];
          for (var k = 0; k < children.length; k++) tryInit(children[k]);
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function bootstrap(container, formId, noRedirect) {
  var containerId = container.id;

  var DEFAULT_STYLE = {
    labelColor: '#555555', labelBg: 'rgba(255,255,255,0.75)', inputBg: 'rgba(255,255,255,0.70)',
    inputBorder: 'rgba(255,255,255,0.85)', inputText: '#111111', placeholderColor: '#aaaaaa', inputRadius: 14,
    inputFocusBorder: '#111111', buttonBg: '#111111', buttonHoverBg: '#333333', buttonText: '#ffffff', buttonRadius: 99,
    formBg: '#EAEAEC', fontFamily: 'Inter, -apple-system, sans-serif', submitLabel: 'Send',
  };

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
      '.wa-cf-success { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; background: rgba(76,175,125,0.08); border: 1px solid rgba(76,175,125,0.25); border-radius: 16px; color: #1f6b43; font-size: 14px; font-weight: 600; line-height: 1.5; margin-top: 14px; width: 100%; box-sizing: border-box; }',
      '.wa-cf-success-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }',
      '.wa-cf-error-msg { padding: 12px 16px; background: rgba(232,66,74,0.06); border: 1px solid rgba(232,66,74,0.2); border-radius: 12px; color: #b0282e; font-size: 13px; font-weight: 500; margin-bottom: 4px; width: 100%; box-sizing: border-box; }',
      '.wa-cf-step-bar { display: flex; gap: 6px; margin-bottom: 18px; width: 100%; }',
      '.wa-cf-step-dot { flex: 1; height: 4px; border-radius: 99px; background: rgba(0,0,0,0.12); transition: background 0.2s; }',
      '.wa-cf-step-dot.active { background: #111; }',
      '.wa-cf-step-dot.done { background: #4caf7d; }',
      '.wa-cf-step-nav { display: flex; gap: 8px; width: 100%; margin-top: 4px; }',
    ].join('\n');
    document.head.appendChild(baseStyle);
  }

  function applyStyleConfig(s) {
    var scopeId = 'wa-cf-style-' + formId;
    var existing = document.getElementById(scopeId);
    if (existing) existing.remove();
    var el = document.createElement('style');
    el.id = scopeId;
    var sc = '#' + containerId;
    el.textContent = [
      sc + ' .wa-cf-wrap { font-family: ' + s.fontFamily + '; background: ' + s.formBg + '; }',
      sc + ' .wa-cf-form label { display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; color: ' + s.labelColor + '; letter-spacing: 0.05em; text-transform: uppercase; background: ' + s.labelBg + '; border: 1px solid rgba(228,228,232,0.9); border-radius: 99px; padding: 3px 10px; width: fit-content; margin-bottom: 0; }',
      sc + ' .wa-cf-form input, ' + sc + ' .wa-cf-form textarea, ' + sc + ' .wa-cf-form select { width: 100%; padding: 11px 16px; border: 1.5px solid ' + s.inputBorder + '; border-radius: ' + s.inputRadius + 'px; font-size: 14px; font-family: ' + s.fontFamily + '; background: ' + s.inputBg + '; color: ' + s.inputText + '; box-shadow: 0 1px 12px rgba(0,0,0,0.04); box-sizing: border-box; outline: none; -webkit-appearance: none; appearance: none; transition: border-color 0.15s, box-shadow 0.15s; }',
      sc + ' .wa-cf-form input::placeholder, ' + sc + ' .wa-cf-form textarea::placeholder { color: ' + s.placeholderColor + '; opacity: 1; }',
      sc + ' .wa-cf-form input:focus, ' + sc + ' .wa-cf-form textarea:focus, ' + sc + ' .wa-cf-form select:focus { border-color: ' + s.inputFocusBorder + ' !important; box-shadow: 0 0 0 3px ' + s.inputFocusBorder + '22 !important; }',
      sc + ' .wa-cf-form textarea { min-height: 110px; resize: vertical; line-height: 1.6; }',
      sc + ' .wa-cf-submit { display: inline-flex; align-items: center; gap: 6px; background: ' + s.buttonBg + '; color: ' + s.buttonText + '; border: none; border-radius: ' + s.buttonRadius + 'px; padding: 11px 26px; font-size: 13px; font-weight: 600; font-family: ' + s.fontFamily + '; cursor: pointer; transition: opacity 0.15s; }',
      sc + ' .wa-cf-submit:hover { background: ' + s.buttonHoverBg + ' !important; opacity: 1; }',
      sc + ' .wa-cf-submit:disabled { opacity: 0.55; cursor: not-allowed; }',
      sc + ' .wa-cf-btn-back { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: ' + s.inputText + '; border: 1.5px solid ' + s.inputBorder + '; border-radius: ' + s.buttonRadius + 'px; padding: 10px 22px; font-size: 13px; font-weight: 600; font-family: ' + s.fontFamily + '; cursor: pointer; transition: opacity 0.15s; }',
      sc + ' .wa-cf-step-dot { background: ' + s.inputBorder + '; }',
      sc + ' .wa-cf-step-dot.active { background: ' + s.buttonBg + ' !important; }',
    ].join('\n');
    document.head.appendChild(el);
  }

  // ── Conditional logic ─────────────────────────────────────────────────────
  // conditions: [{ fieldId, operator, value, action, targetId }]
  // operator: 'equals' | 'not_equals' | 'contains' | 'not_empty' | 'empty'
  // action: 'show' | 'hide'

  function evaluateCondition(cond, formEl) {
    var srcEl = formEl.querySelector('[name="' + cond.fieldId + '"]');
    if (!srcEl) return false;
    var val = srcEl.type === 'checkbox' ? (srcEl.checked ? 'yes' : '') : srcEl.value;
    switch (cond.operator) {
      case 'equals':     return val === cond.value;
      case 'not_equals': return val !== cond.value;
      case 'contains':   return val.indexOf(cond.value) !== -1;
      case 'not_empty':  return val.trim() !== '';
      case 'empty':      return val.trim() === '';
      default:           return false;
    }
  }

  function applyConditions(conditions, formEl) {
    if (!conditions || !conditions.length) return;
    conditions.forEach(function (cond) {
      var targetWrap = formEl.querySelector('[data-field-id="' + cond.targetId + '"]');
      if (!targetWrap) return;
      var show = evaluateCondition(cond, formEl);
      if (cond.action === 'hide') show = !show;
      targetWrap.style.display = show ? '' : 'none';
      // disable required on hidden fields so they don't block submit
      var inputs = targetWrap.querySelectorAll('input, textarea, select');
      inputs.forEach(function (inp) { inp.disabled = !show; });
    });
  }

  function attachConditionListeners(conditions, formEl) {
    if (!conditions || !conditions.length) return;
    var triggerIds = {};
    conditions.forEach(function (c) { triggerIds[c.fieldId] = true; });
    Object.keys(triggerIds).forEach(function (fid) {
      var el = formEl.querySelector('[name="' + fid + '"]');
      if (el) {
        el.addEventListener('change', function () { applyConditions(conditions, formEl); });
        el.addEventListener('input', function () { applyConditions(conditions, formEl); });
      }
    });
    applyConditions(conditions, formEl);
  }

  // ── Split fields into steps (groups separated by 'step' type) ────────────
  function splitIntoSteps(fields) {
    var steps = [[]];
    fields.forEach(function (f) {
      if (f.type === 'step') { steps.push([]); }
      else { steps[steps.length - 1].push(f); }
    });
    return steps.filter(function (s) { return s.length > 0; });
  }

  // ── Build a single field element ──────────────────────────────────────────
  function buildFieldEl(f, s, errors) {
    if (f.type === 'hidden') {
      var hi = document.createElement('input');
      hi.type = 'hidden'; hi.name = f.name || f.id; hi.value = f.defaultValue || '';
      return hi;
    }

    var widthPct = (f.width || 100) + '%';
    var wrap = document.createElement('div');
    wrap.className = 'wa-cf-field';
    wrap.style.cssText = 'width: calc(' + widthPct + ' - 7px);';
    wrap.setAttribute('data-field-id', f.name || f.id);

    if (f.type === 'radio') {
      if (!f.hideLabel) {
        var rl = document.createElement('label');
        rl.textContent = (f.label || '') + (f.required ? ' *' : '');
        wrap.appendChild(rl);
      }
      var radioWrap = document.createElement('div');
      radioWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      (f.options || '').split(',').map(function (o) { return o.trim(); }).filter(Boolean).forEach(function (opt) {
        var lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:' + s.inputText + ';text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
        var ri = document.createElement('input');
        ri.type = 'radio'; ri.name = f.name || f.id; ri.value = opt;
        ri.style.cssText = 'width:16px;height:16px;margin:0;accent-color:' + s.buttonBg + ';';
        if (f.required) ri.required = true;
        lbl.appendChild(ri); lbl.appendChild(document.createTextNode(opt));
        radioWrap.appendChild(lbl);
      });
      wrap.appendChild(radioWrap);
      return wrap;
    }

    if (f.type === 'checkbox') {
      var cblbl = document.createElement('label');
      cblbl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:14px;color:' + s.inputText + ';text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
      var cbi = document.createElement('input');
      cbi.type = 'checkbox'; cbi.name = f.name || f.id;
      cbi.style.cssText = 'width:16px;height:16px;margin:0;accent-color:' + s.buttonBg + ';';
      if (f.required) cbi.required = true;
      cblbl.appendChild(cbi); cblbl.appendChild(document.createTextNode(f.placeholder || f.label || ''));
      wrap.appendChild(cblbl);
      return wrap;
    }

    if (f.type === 'acceptance') {
      var aclbl = document.createElement('label');
      aclbl.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:13px;color:' + s.inputText + ';line-height:1.5;text-transform:none;background:none;border:none;padding:0;border-radius:0;letter-spacing:0;';
      var aci = document.createElement('input');
      aci.type = 'checkbox'; aci.name = f.name || f.id;
      aci.style.cssText = 'width:16px;height:16px;margin-top:2px;flex-shrink:0;accent-color:' + s.buttonBg + ';';
      if (f.required) aci.required = true;
      var acspan = document.createElement('span');
      acspan.textContent = f.placeholder || 'I agree to the terms and conditions';
      aclbl.appendChild(aci); aclbl.appendChild(acspan);
      wrap.appendChild(aclbl);
      return wrap;
    }

    if (f.type === 'html') {
      var htmlDiv = document.createElement('div');
      htmlDiv.style.cssText = 'font-size:14px;color:' + s.inputText + ';line-height:1.6;width:100%;';
      htmlDiv.innerHTML = f.defaultValue || '';
      wrap.appendChild(htmlDiv);
      return wrap;
    }

    if (f.type === 'recaptcha' || f.type === 'recaptchav3') {
      var rcId = 'wa-rc-' + formId + '-' + (f.name || f.id);
      wrap.setAttribute('data-recaptcha', f.type);
      wrap.setAttribute('data-recaptcha-field', f.name || f.id);
      wrap.id = rcId;
      // placeholder — real widget mounted after render
      return wrap;
    }

    if (f.type === 'file') {
      if (!f.hideLabel) {
        var fl = document.createElement('label');
        fl.textContent = (f.label || 'File') + (f.required ? ' *' : '');
        wrap.appendChild(fl);
      }
      var fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.name = f.name || f.id;
      if (f.required) fileInput.required = true;
      wrap.appendChild(fileInput);
      return wrap;
    }

    // Standard inputs
    if (!f.hideLabel && f.type !== 'hidden') {
      var lbl = document.createElement('label');
      lbl.textContent = (f.label || '') + (f.required ? ' *' : '');
      wrap.appendChild(lbl);
    }

    var input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 5;
      input.placeholder = f.placeholder || '';
    } else if (f.type === 'select') {
      input = document.createElement('select');
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = f.selectPlaceholder || f.placeholder || '— Select —';
      input.appendChild(blank);
      (f.options || '').split(',').map(function (o) { return o.trim(); }).filter(Boolean).forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      input.placeholder = f.placeholder || '';
      if (f.defaultValue) input.value = f.defaultValue;
    }

    input.name = f.name || f.id;
    if (f.required) input.required = true;
    wrap.appendChild(input);

    if (errors && errors[f.name || f.id]) {
      var err = document.createElement('div');
      err.className = 'wa-cf-field-error';
      err.textContent = errors[f.name || f.id];
      wrap.appendChild(err);
    }
    return wrap;
  }

  // ── Mount reCAPTCHA widgets ───────────────────────────────────────────────
  function mountRecaptcha(formEl, siteKeys) {
    var widgets = formEl.querySelectorAll('[data-recaptcha]');
    if (!widgets.length) return;
    var needsV2 = false, needsV3 = false;
    widgets.forEach(function (w) {
      if (w.getAttribute('data-recaptcha') === 'recaptcha') needsV2 = true;
      else needsV3 = true;
    });

    function doMount() {
      widgets.forEach(function (w) {
        var type = w.getAttribute('data-recaptcha');
        if (type === 'recaptcha' && siteKeys.v2 && window.grecaptcha && window.grecaptcha.render) {
          try {
            var target = w.id ? w.id : w;
            window.grecaptcha.render(target, {
              sitekey: siteKeys.v2,
              callback: function (token) {
                var hi = formEl.querySelector('input[name="g-recaptcha-response"]');
                if (!hi) { hi = document.createElement('input'); hi.type = 'hidden'; hi.name = 'g-recaptcha-response'; formEl.appendChild(hi); }
                hi.value = token;
              },
            });
          } catch (e) { console.warn('reCAPTCHA render error:', e); }
        } else if (type === 'recaptchav3' && siteKeys.v3 && window.grecaptcha && window.grecaptcha.ready) {
          window.grecaptcha.ready(function () {
            // Execute on submit — attach listener
            formEl.addEventListener('submit', function handler(e) {
              if (formEl.querySelector('input[name="g-recaptcha-response-v3"]')) return;
              e.preventDefault(); e.stopImmediatePropagation();
              window.grecaptcha.execute(siteKeys.v3, { action: 'submit' }).then(function (token) {
                var hi = document.createElement('input');
                hi.type = 'hidden'; hi.name = 'g-recaptcha-response-v3'; hi.value = token;
                formEl.appendChild(hi);
                formEl.removeEventListener('submit', handler);
                formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              });
            }, true);
            w.innerHTML = '<div style="font-size:11px;color:#888;padding:4px 0;">🛡 Protected by reCAPTCHA v3 (invisible)</div>';
          });
        }
      });
    }

    if (needsV2 && siteKeys.v2) {
      // v2: use explicit render mode with onload callback so grecaptcha.render is available
      var cbName = 'waRcLoaded_' + formId;
      window[cbName] = doMount;
      if (!document.querySelector('script[src*="recaptcha/api.js"]')) {
        var rcScript = document.createElement('script');
        rcScript.src = 'https://www.google.com/recaptcha/api.js?onload=' + cbName + '&render=explicit';
        rcScript.async = true; rcScript.defer = true;
        document.head.appendChild(rcScript);
      } else if (window.grecaptcha && window.grecaptcha.render) {
        doMount();
      } else {
        // script loading but grecaptcha not ready yet — poll briefly
        var t = 0;
        var iv = setInterval(function () {
          if (window.grecaptcha && window.grecaptcha.render) { clearInterval(iv); doMount(); }
          if (++t > 20) clearInterval(iv);
        }, 250);
      }
    } else if (needsV3 && siteKeys.v3) {
      if (!document.querySelector('script[src*="recaptcha/api.js"]')) {
        var rcScript3 = document.createElement('script');
        rcScript3.src = 'https://www.google.com/recaptcha/api.js?render=' + siteKeys.v3;
        rcScript3.async = true; rcScript3.defer = true;
        rcScript3.onload = doMount;
        document.head.appendChild(rcScript3);
      } else { doMount(); }
    }
  }

  // ── Collect all form values ───────────────────────────────────────────────
  function collectValues(formEl) {
    var values = {};
    formEl.querySelectorAll('input[name]:not([disabled]), textarea[name]:not([disabled]), select[name]:not([disabled])').forEach(function (el) {
      if (el.type === 'checkbox') { values[el.name] = el.checked ? 'yes' : ''; }
      else if (el.type !== 'file') { values[el.name] = el.value; }
    });
    return values;
  }

  function hasFiles(formEl) {
    var fileInputs = formEl.querySelectorAll('input[type="file"][name]:not([disabled])');
    for (var i = 0; i < fileInputs.length; i++) {
      if (fileInputs[i].files && fileInputs[i].files.length > 0) return true;
    }
    return false;
  }

  function buildFormData(formEl) {
    var fd = new FormData();
    formEl.querySelectorAll('input[name]:not([disabled]), textarea[name]:not([disabled]), select[name]:not([disabled])').forEach(function (el) {
      if (el.type === 'file') { if (el.files && el.files.length > 0) fd.append(el.name, el.files[0]); }
      else if (el.type === 'checkbox') { fd.append(el.name, el.checked ? 'yes' : ''); }
      else { fd.append(el.name, el.value); }
    });
    return fd;
  }

  function showSuccess(redirectUrl, submitBtn, successMessage) {
    if (!noRedirect && redirectUrl && redirectUrl.trim()) { window.location.href = redirectUrl.trim(); return; }
    // Reset button
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitBtn._origLabel || 'Send'; }
    var existing = container.querySelector('.wa-cf-success');
    if (existing) existing.remove();
    var text = (successMessage || "Your message was sent successfully.\nWe'll be in touch soon.").replace(/\n/g, '<br>');
    var msg = document.createElement('div');
    msg.className = 'wa-cf-success';
    msg.innerHTML = '<div class="wa-cf-success-icon">✓</div><div>' + text + '</div>';
    if (submitBtn && submitBtn.parentElement) {
      submitBtn.parentElement.insertAdjacentElement('afterend', msg);
    } else {
      container.appendChild(msg);
    }
  }

  function showError(msg) {
    var existing = container.querySelector('.wa-cf-error-msg');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.className = 'wa-cf-error-msg'; div.textContent = msg;
    var form = container.querySelector('form');
    if (form) form.insertAdjacentElement('beforebegin', div);
    else container.insertAdjacentElement('afterbegin', div);
  }

  // ── Multi-step renderer ───────────────────────────────────────────────────
  function renderMultiStep(steps, conditions, s, redirectUrl, otpEnabled) {
    var currentStep = 0;
    // Single persistent form element — all fields exist in DOM, steps hide/show
    var wrap = document.createElement('div');
    wrap.className = 'wa-cf-wrap';
    wrap.style.cssText = 'padding: 24px; font-family: ' + s.fontFamily + '; background: ' + s.formBg + ';';

    // Step progress bar
    var bar = document.createElement('div');
    bar.className = 'wa-cf-step-bar';
    steps.forEach(function () {
      var dot = document.createElement('div');
      dot.className = 'wa-cf-step-dot';
      bar.appendChild(dot);
    });
    wrap.appendChild(bar);

    var form = document.createElement('form');
    form.className = 'wa-cf-form';

    // Render all step groups as sections
    var sections = steps.map(function (stepFields, idx) {
      var sec = document.createElement('div');
      sec.style.cssText = 'width:100%;display:flex;flex-wrap:wrap;gap:14px;';
      sec.setAttribute('data-step', String(idx));
      stepFields.forEach(function (f) {
        var el = buildFieldEl(f, s, null);
        sec.appendChild(el);
      });
      form.appendChild(sec);
      return sec;
    });

    // Nav buttons row
    var navRow = document.createElement('div');
    navRow.className = 'wa-cf-step-nav';

    var backBtn = document.createElement('button');
    backBtn.type = 'button'; backBtn.className = 'wa-cf-btn-back';
    backBtn.textContent = '← Back';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'wa-cf-submit';
    nextBtn.textContent = 'Next →';

    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit'; submitBtn.className = 'wa-cf-submit';
    submitBtn.textContent = s.submitLabel || 'Send';

    navRow.appendChild(backBtn);
    navRow.appendChild(nextBtn);
    navRow.appendChild(submitBtn);
    form.appendChild(navRow);
    wrap.appendChild(form);

    function updateView() {
      var dots = bar.querySelectorAll('.wa-cf-step-dot');
      dots.forEach(function (d, i) {
        d.className = 'wa-cf-step-dot' + (i < currentStep ? ' done' : i === currentStep ? ' active' : '');
      });
      sections.forEach(function (sec, i) { sec.style.display = i === currentStep ? '' : 'none'; });
      backBtn.style.display = currentStep === 0 ? 'none' : '';
      nextBtn.style.display = currentStep < steps.length - 1 ? '' : 'none';
      submitBtn.style.display = currentStep === steps.length - 1 ? '' : 'none';
    }

    function validateStep(idx) {
      var sec = sections[idx];
      var valid = true;
      sec.querySelectorAll('input[required]:not([disabled]), textarea[required]:not([disabled]), select[required]:not([disabled])').forEach(function (inp) {
        if (inp.type === 'checkbox' && !inp.checked) { inp.reportValidity && inp.reportValidity(); valid = false; }
        else if (!inp.value.trim()) { inp.reportValidity && inp.reportValidity(); valid = false; }
      });
      return valid;
    }

    nextBtn.addEventListener('click', function () {
      if (!validateStep(currentStep)) return;
      if (currentStep < steps.length - 1) { currentStep++; updateView(); wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });

    backBtn.addEventListener('click', function () {
      if (currentStep > 0) { currentStep--; updateView(); }
    });

    // Final submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitBtn._origLabel = submitBtn._origLabel || submitBtn.textContent;
      submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
      var useFiles = hasFiles(form);
      var fetchOpts = useFiles
        ? { method: 'POST', body: buildFormData(form) }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectValues(form)) };
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/submit', fetchOpts)
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) { showSuccess(redirectUrl, submitBtn, s.successMessage); }
          else { submitBtn.disabled = false; submitBtn.textContent = s.submitLabel || 'Send'; showError(r.data.error || 'Submission failed.'); }
        })
        .catch(function () { submitBtn.disabled = false; submitBtn.textContent = s.submitLabel || 'Send'; showError('Network error. Please try again.'); });
    });

    updateView();
    container.innerHTML = '';
    container.appendChild(wrap);

    attachConditionListeners(conditions, form);
    if (otpEnabled) injectOtp(form, s);
    return form;
  }

  // ── Single-page renderer ──────────────────────────────────────────────────
  function renderForm(fields, conditions, s, redirectUrl, otpEnabled) {
    var wrap = document.createElement('div');
    wrap.className = 'wa-cf-wrap';
    wrap.style.cssText = 'padding: 24px; font-family: ' + s.fontFamily + '; background: ' + s.formBg + ';';

    var form = document.createElement('form');
    form.className = 'wa-cf-form';

    fields.forEach(function (f) {
      var el = buildFieldEl(f, s, null);
      form.appendChild(el);
    });

    var submitRow = document.createElement('div');
    submitRow.style.cssText = 'width:100%;';
    var btn = document.createElement('button');
    btn.type = 'submit'; btn.className = 'wa-cf-submit';
    btn.textContent = s.submitLabel || 'Send';
    submitRow.appendChild(btn);
    form.appendChild(submitRow);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn._origLabel = btn._origLabel || btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';
      var useFiles = hasFiles(form);
      var fetchOpts = useFiles
        ? { method: 'POST', body: buildFormData(form) }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectValues(form)) };
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/submit', fetchOpts)
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) { showSuccess(redirectUrl, btn, s.successMessage); }
          else { btn.disabled = false; btn.textContent = s.submitLabel || 'Send'; showError(r.data.error || 'Submission failed.'); }
        })
        .catch(function () { btn.disabled = false; btn.textContent = s.submitLabel || 'Send'; showError('Network error. Please try again.'); });
    });

    wrap.appendChild(form);
    container.innerHTML = '';
    container.appendChild(wrap);

    attachConditionListeners(conditions, form);
    if (otpEnabled) injectOtp(form, s);
    return form;
  }

  // ── OTP injection (unchanged logic, works on any form) ───────────────────
  function injectOtp(formEl, s) {
    var emailInput = formEl.querySelector('input[type="email"], input[name="email"]');
    var submitBtn = formEl.querySelector('button[type="submit"]');
    if (!emailInput || !submitBtn) return;
    submitBtn.disabled = true;
    var otpReady = false;

    formEl.addEventListener('submit', function (e) {
      if (!otpReady) { e.preventDefault(); e.stopImmediatePropagation(); otpStatus.style.color = '#E8424A'; otpStatus.textContent = 'Please verify your email first.'; }
    }, true);

    var otpRow = document.createElement('div');
    otpRow.className = 'wa-cf-field'; otpRow.style.display = 'none'; otpRow.style.width = '100%';
    var otpLabel = document.createElement('label'); otpLabel.textContent = 'Verification Code *'; otpRow.appendChild(otpLabel);
    var otpInputWrap = document.createElement('div'); otpInputWrap.style.cssText = 'display:flex;gap:8px;';
    var otpInput = document.createElement('input');
    otpInput.type = 'text'; otpInput.name = '__otp'; otpInput.placeholder = '6-digit code'; otpInput.maxLength = 6;
    otpInput.style.cssText = 'flex:1;letter-spacing:0.15em;font-size:18px;text-align:center;';
    var verifyBtn = document.createElement('button');
    verifyBtn.type = 'button'; verifyBtn.textContent = 'Verify';
    verifyBtn.style.cssText = 'background:' + s.buttonBg + ';color:' + s.buttonText + ';border:none;border-radius:' + s.buttonRadius + 'px;padding:0 20px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';
    otpInputWrap.appendChild(otpInput); otpInputWrap.appendChild(verifyBtn); otpRow.appendChild(otpInputWrap);
    var otpStatus = document.createElement('div'); otpStatus.style.cssText = 'font-size:12px;margin-top:4px;'; otpRow.appendChild(otpStatus);

    var emailWrap = emailInput.closest('.wa-cf-field') || emailInput.parentElement;
    var sendBtn = document.createElement('button');
    sendBtn.type = 'button'; sendBtn.textContent = 'Send OTP';
    sendBtn.style.cssText = 'margin-top:8px;background:' + s.buttonBg + ';color:' + s.buttonText + ';border:none;border-radius:' + s.buttonRadius + 'px;padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;';
    emailWrap.appendChild(sendBtn);
    submitBtn.parentElement.insertBefore(otpRow, submitBtn);

    sendBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) { showError('Please enter your email first.'); return; }
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; otpReady = false; submitBtn.disabled = true;
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) { sendBtn.textContent = 'Resend OTP'; sendBtn.disabled = false; otpRow.style.display = ''; otpStatus.style.color = '#555'; otpStatus.textContent = 'Code sent to ' + email + '. Valid for 10 minutes.'; otpInput.value = ''; submitBtn.disabled = true; otpInput.focus(); }
          else { sendBtn.disabled = false; sendBtn.textContent = 'Send OTP'; showError(r.data.error || 'Failed to send OTP.'); }
        }).catch(function () { sendBtn.disabled = false; sendBtn.textContent = 'Send OTP'; showError('Network error.'); });
    });

    verifyBtn.addEventListener('click', function () {
      var code = otpInput.value.trim();
      if (code.length !== 6) { otpStatus.style.color = '#E8424A'; otpStatus.textContent = 'Enter the 6-digit code.'; return; }
      verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
      fetch(apiBase + '/api/public/contact-forms/forms/' + formId + '/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailInput.value.trim(), otp: code }),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          verifyBtn.disabled = false; verifyBtn.textContent = 'Verify';
          if (r.ok) { otpReady = true; otpStatus.style.color = '#1f6b43'; otpStatus.textContent = '✓ Email verified. You can now submit.'; submitBtn.disabled = false; }
          else { otpStatus.style.color = '#E8424A'; otpStatus.textContent = r.data.error || 'Invalid code.'; }
        }).catch(function () { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify'; otpStatus.style.color = '#E8424A'; otpStatus.textContent = 'Network error.'; });
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  fetch(apiBase + '/api/public/contact-forms/forms/' + formId)
    .then(function (res) { return res.json(); })
    .then(function (form) {
      var savedStyle = {};
      if (form.style_config) { try { savedStyle = JSON.parse(form.style_config); } catch (e) {} }
      var s = Object.assign({}, DEFAULT_STYLE, savedStyle);
      applyStyleConfig(s);

      var fields = form.fields || [];
      var conditions = form.conditions || [];

      // Determine if multi-step (any 'step' type field present)
      var hasSteps = fields.some(function (f) { return f.type === 'step'; });
      var formEl;

      if (hasSteps) {
        var steps = splitIntoSteps(fields);
        formEl = renderMultiStep(steps, conditions, s, form.redirect_url, form.otp_enabled);
      } else {
        formEl = renderForm(fields, conditions, s, form.redirect_url, form.otp_enabled);
      }

      // Mount reCAPTCHA (fetch site keys from app settings via public config embedded in form)
      var siteKeys = { v2: form.recaptcha_v2_site_key || '', v3: form.recaptcha_v3_site_key || '' };
      mountRecaptcha(formEl, siteKeys);
    })
    .catch(function () {
      container.innerHTML = '<div class="wa-cf-error-msg">Form could not be loaded.</div>';
    });
  } // end bootstrap
})();
