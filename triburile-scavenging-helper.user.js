// ==UserScript==
// @name         Triburile - Distributie Curatare Improved
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  Distribuie trupele pentru curatare si completeaza secvential: extrema > mare > medie > mica
// @author       Marrcky
// @match        *://triburile.ro/*
// @match        *://*.triburile.ro/*
// @match        *://triburile.net/*
// @match        *://*.triburile.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const RATIOS = {
        spear:   { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        sword:   { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        axe:     { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        archer:  { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        light:   { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        marcher: { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        heavy:   { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
        knight:  { mica: 6, medie: 3, mare: 1.75, extrema: 1 },
    };

    const TROOP_NAMES = {
        spear: 'Lancier',
        sword: 'Spadasin',
        axe: 'Toporas',
        archer: 'Arcas',
        light: 'Cav.usoara',
        marcher: 'Cav.arc',
        heavy: 'Cav.grea',
        knight: 'Paladin',
    };

    const LEVEL_TITLES = [
        { key: 'mica',    patterns: ['mica', 'mică'] },
        { key: 'medie',   patterns: ['medie'] },
        { key: 'mare',    patterns: ['mare'] },
        { key: 'extrema', patterns: ['extrem', 'extremă', 'extrema'] },
    ];

    const FILL_ORDER = ['extrema', 'mare', 'medie', 'mica'];
    const KEY_ORDER  = ['mica', 'medie', 'mare', 'extrema'];
    const TROOP_ORDER = ['spear','sword','axe','archer','light','marcher','heavy','knight'];

    let lastResult = null;
    let lastAll = null;
    let lastActive = null;

    let seqQueue = [];
    let seqIdx = 0;
    let enterListener = null;

    function isScavengePage() {
        return window.location.href.includes('mode=scavenge') ||
               !!document.querySelector('.scavenge-option') ||
               !!document.querySelector('.candidate-squad-container') ||
               !!document.querySelector('.candidate-squad-widget');
    }

    function normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function parseTroopNumber(text) {
        if (!text) return 0;

        const raw = String(text).trim();

        const parenMatch = raw.match(/\(([\d\s.,]+)\)/);
        const normalMatch = raw.match(/([\d\s.,]+)/);

        const match = parenMatch || normalMatch;

        if (!match) return 0;

        return parseInt(
            match[1]
                .replace(/\./g, '')
                .replace(/,/g, '')
                .replace(/\s/g, ''),
            10
        ) || 0;
    }

    function getScavengeOptions() {
        const options = [];

        document.querySelectorAll('div.scavenge-option').forEach(function(container) {
            const titleEl = container.querySelector('div.title');
            if (!titleEl) return;

            const titleText = normalizeText(titleEl.innerText || titleEl.textContent);
            const isLocked = !!container.querySelector('.locked-view');

            let foundKey = null;

            LEVEL_TITLES.forEach(function(lv) {
                lv.patterns.forEach(function(p) {
                    if (titleText.includes(normalizeText(p))) {
                        foundKey = lv.key;
                    }
                });
            });

            if (foundKey) {
                options.push({
                    key: foundKey,
                    label: (titleEl.innerText || titleEl.textContent).trim(),
                    locked: isLocked,
                    container: container,
                });
            }
        });

        return options;
    }

    function readTroops() {
        const troops = {};

        Object.keys(RATIOS).forEach(function(unit) {
            let found = 0;

            const links = document.querySelectorAll(
                'a[data-unit="' + unit + '"], a.units-entry-all[data-unit="' + unit + '"]'
            );

            links.forEach(function(link) {
                if (found > 0) return;

                const text = link.textContent || link.innerText || '';
                const parsed = parseTroopNumber(text);

                if (parsed > 0) {
                    found = parsed;
                }
            });

            if (found <= 0) {
                const input = document.querySelector('input[name="' + unit + '"]');

                if (input) {
                    const td = input.closest('td');

                    if (td) {
                        const link = td.querySelector('a[data-unit="' + unit + '"]');

                        if (link) {
                            found = parseTroopNumber(link.textContent || link.innerText || '');
                        }
                    }
                }
            }

            if (found <= 0) {
                const input = document.querySelector('input[name="' + unit + '"]');

                if (input) {
                    const parent = input.parentElement;

                    if (parent) {
                        const text = parent.textContent || parent.innerText || '';
                        found = parseTroopNumber(text);
                    }
                }
            }

            if (found <= 0) {
                const input = document.querySelector('input[name="' + unit + '"]');

                if (input) {
                    const max = parseInt(input.getAttribute('max'), 10);

                    if (max > 0 && max < 99999) {
                        found = max;
                    }
                }
            }

            if (found > 0) {
                troops[unit] = found;
            }
        });

        console.log('[Curatare] Trupe detectate:', troops);

        return troops;
    }

    function calculate(troops, activeScavenges, customRatios) {
        const result = {};

        activeScavenges.forEach(function(s) {
            result[s.key] = {
                label: s.label,
                total: 0,
                breakdown: {}
            };
        });

        Object.keys(troops).forEach(function(tKey) {
            const avail = troops[tKey];
            const ratios = customRatios[tKey] || RATIOS[tKey];

            const parts = activeScavenges.map(function(s) {
                return ratios[s.key] || 1;
            });

            const sum = parts.reduce(function(a, b) {
                return a + b;
            }, 0);

            let distributed = 0;

            activeScavenges.forEach(function(s, i) {
                let cnt = Math.floor(avail * parts[i] / sum);

                if (i === activeScavenges.length - 1) {
                    cnt = avail - distributed;
                }

                distributed += cnt;

                result[s.key].breakdown[tKey] = cnt;
                result[s.key].total += cnt;
            });
        });

        return result;
    }

    function getTroopInputs() {
        let container = document.querySelector('.candidate-squad-container');

        if (!container) {
            container = document.querySelector('.candidate-squad-widget');
        }

        if (!container) {
            container = document;
        }

        return container.querySelectorAll(
            'input[name="spear"], input[name="sword"], input[name="axe"], input[name="archer"], input[name="light"], input[name="marcher"], input[name="heavy"], input[name="knight"]'
        );
    }

    function setInputValue(input, value) {
        const finalValue = value > 0 ? String(value) : '';

        try {
            input.focus();
        } catch (e) {}

        try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, finalValue);
        } catch (e) {
            input.value = finalValue;
        }

        input.setAttribute('value', finalValue);

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0', keyCode: 48, which: 48 }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0', keyCode: 48, which: 48 }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));

        if (window.jQuery) {
            try {
                window.jQuery(input)
                    .val(finalValue)
                    .trigger('input')
                    .trigger('change')
                    .trigger('keyup')
                    .trigger('blur');
            } catch (e) {}
        }
    }

    function clearInputs() {
        const inputs = getTroopInputs();

        inputs.forEach(function(input) {
            setInputValue(input, 0);
        });
    }

    function fillInputs(breakdown) {
        const inputs = getTroopInputs();

        console.log('[Curatare] Inputuri gasite:', inputs.length);
        console.log('[Curatare] Breakdown:', breakdown);

        if (!inputs.length) {
            updateStatus('⚠ Nu gasesc inputurile de trupe.', 'error');
            return false;
        }

        inputs.forEach(function(input) {
            const unitName = input.getAttribute('name');

            if (!RATIOS[unitName]) return;

            const val = breakdown[unitName] || 0;

            console.log('[Curatare] Setez', unitName, '=', val);

            setInputValue(input, val);
        });

        return true;
    }

    function startSequence(queue) {
        seqQueue = queue;
        seqIdx = 0;

        if (!seqQueue.length) {
            updateStatus('⚠ Nu exista curatari deblocate.', 'error');
            return;
        }

        fillCurrentAndWaitEnter();
    }

    function fillCurrentAndWaitEnter() {
        if (seqIdx >= seqQueue.length) {
            updateStatus('✓ Toate curatarile au fost completate.', 'success');

            if (lastAll && lastResult) {
                renderSlots(lastResult, lastAll, null);
            }

            const btn = document.getElementById('cb-btn-fill');

            if (btn) {
                btn.style.display = 'block';
                btn.disabled = false;
                btn.textContent = '▶ Reia completarea';
            }

            return;
        }

        const opt = seqQueue[seqIdx];
        const slot = lastResult[opt.key];

        if (!slot) {
            seqIdx++;
            fillCurrentAndWaitEnter();
            return;
        }

        if (lastAll && lastResult) {
            renderSlots(lastResult, lastAll, opt.key);
        }

        updateStatus(
            '⏳ Am completat pentru <b>' + slot.label + '</b> (' + (seqIdx + 1) + '/' + seqQueue.length + '). Apasa <b>Enter</b>, apoi completez urmatoarea.',
            'info'
        );

        clearInputs();

        setTimeout(function() {
            const ok = fillInputs(slot.breakdown);

            if (!ok) return;

            waitForEnterThenNext();
        }, 150);
    }

    function waitForEnterThenNext() {
        if (enterListener) {
            document.removeEventListener('keydown', enterListener, true);
            enterListener = null;
        }

        enterListener = function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                document.removeEventListener('keydown', enterListener, true);
                enterListener = null;

                seqIdx++;

                setTimeout(function() {
                    fillCurrentAndWaitEnter();
                }, 500);
            }
        };

        document.addEventListener('keydown', enterListener, true);
    }

    function updateStatus(msg, type) {
        const el = document.getElementById('cb-status');

        if (!el) return;

        el.innerHTML = msg;

        if (type === 'success') {
            el.style.color = '#1a6b10';
        } else if (type === 'error') {
            el.style.color = '#8b0000';
        } else {
            el.style.color = '#7a5a10';
        }
    }

    function renderSlots(result, allOptions, highlightKey) {
        const container = document.getElementById('cb-slots-container');

        if (!container) return;

        container.innerHTML = '<div class="cb-stitle">DISTRIBUTIE PER CURATARE</div>';

        KEY_ORDER.forEach(function(key) {
            let opt = null;

            allOptions.forEach(function(o) {
                if (o.key === key) opt = o;
            });

            if (!opt) return;

            const slot = result[key];
            const isHL = key === highlightKey;

            const div = document.createElement('div');
            div.className = 'cb-slot' + (opt.locked ? ' cb-locked' : '') + (isHL ? ' cb-highlight' : '');

            if (opt.locked) {
                div.innerHTML =
                    '<div class="cb-slot-name">' + opt.label + '</div>' +
                    '<div style="font-size:11px;color:#aaa">Blocat</div>';
            } else if (slot) {
                const units = [];

                TROOP_ORDER.forEach(function(k) {
                    if (slot.breakdown[k] > 0) {
                        units.push((TROOP_NAMES[k] || k) + ': <b>' + slot.breakdown[k] + '</b>');
                    }
                });

                div.innerHTML =
                    '<div class="cb-slot-name">' + (isHL ? '▶ ' : '') + slot.label + '</div>' +
                    '<div class="cb-slot-total">' + slot.total.toLocaleString() + ' <span style="font-size:12px;font-weight:normal">trupe</span></div>' +
                    '<div class="cb-slot-units">' + (units.join('&nbsp; ') || '—') + '</div>';
            }

            container.appendChild(div);
        });
    }

    function makeDraggable(el, handle) {
        let ox = 0;
        let oy = 0;
        let mx = 0;
        let my = 0;

        handle.addEventListener('mousedown', function(e) {
            e.preventDefault();

            mx = e.clientX;
            my = e.clientY;

            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', onStop);
        });

        function onDrag(e) {
            ox = mx - e.clientX;
            oy = my - e.clientY;

            mx = e.clientX;
            my = e.clientY;

            el.style.top = (el.offsetTop - oy) + 'px';
            el.style.right = 'auto';
            el.style.left = (el.offsetLeft - ox) + 'px';
        }

        function onStop() {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', onStop);
        }
    }

    const CSS = `
    #cb-panel {
        position: fixed !important;
        top: 60px !important;
        right: 10px !important;
        z-index: 2147483647 !important;
        width: 320px;
        background: linear-gradient(160deg,#f9eecc,#eedfa0);
        border: 2px solid #9a7a2a;
        border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.5);
        font-family: Arial,sans-serif;
        font-size: 13px;
        color: #3a2800;
    }

    #cb-header {
        background: linear-gradient(90deg,#8a5a10,#c4922a);
        border-radius: 8px 8px 0 0;
        padding: 9px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
    }

    #cb-header-title {
        font-weight: bold;
        font-size: 14px;
        color: #fff;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }

    #cb-close {
        background: rgba(0,0,0,0.3);
        border: none;
        color: #fff;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 15px;
        line-height: 22px;
        text-align: center;
        padding: 0;
    }

    #cb-body {
        padding: 10px 12px 8px;
    }

    .cb-stitle {
        font-size: 10px;
        font-weight: bold;
        color: #7a5a10;
        text-transform: uppercase;
        letter-spacing: .05em;
        margin: 8px 0 5px;
        border-bottom: 1px solid #c8a84e;
        padding-bottom: 2px;
    }

    .cb-slot {
        background: rgba(200,168,60,.18);
        border: 1px solid #c8a84e;
        border-radius: 6px;
        padding: 6px 10px;
        margin-bottom: 6px;
        transition: all .2s;
    }

    .cb-highlight {
        background: rgba(46,168,34,.2) !important;
        border-color: #2ea822 !important;
    }

    .cb-locked {
        opacity: .4;
    }

    .cb-slot-name {
        font-weight: bold;
        font-size: 12px;
        color: #5a3a00;
        margin-bottom: 2px;
    }

    .cb-slot-total {
        font-size: 22px;
        font-weight: bold;
        color: #3a2800;
    }

    .cb-slot-units {
        font-size: 11px;
        color: #7a5a10;
        margin-top: 2px;
        line-height: 1.7;
    }

    .cb-slot-units b {
        color: #3a2800;
    }

    #cb-btn-calc {
        width: 100%;
        padding: 8px;
        background: linear-gradient(90deg,#8a5a10,#c4922a);
        border: none;
        border-radius: 6px;
        color: #fff;
        font-weight: bold;
        font-size: 13px;
        cursor: pointer;
        margin-top: 4px;
        text-shadow: 0 1px 2px rgba(0,0,0,.4);
    }

    #cb-btn-fill {
        width: 100%;
        padding: 8px;
        background: linear-gradient(90deg,#1a6b10,#2ea822);
        border: none;
        border-radius: 6px;
        color: #fff;
        font-weight: bold;
        font-size: 13px;
        cursor: pointer;
        margin-top: 6px;
        text-shadow: 0 1px 2px rgba(0,0,0,.4);
        display: none;
    }

    #cb-status {
        font-size: 11px;
        color: #7a5a10;
        margin: 6px 0;
        min-height: 15px;
        text-align: center;
        line-height: 1.5;
    }

    #cb-toggle-settings {
        background: none;
        border: 1px solid #c8a84e;
        border-radius: 4px;
        color: #7a5a10;
        font-size: 11px;
        cursor: pointer;
        padding: 3px 8px;
        margin: 5px 0 2px;
        width: 100%;
    }

    #cb-settings {
        border-top: 1px solid #c8a84e;
        padding: 8px 12px 12px;
        display: none;
    }

    .cb-rgrid {
        display: grid;
        grid-template-columns: 85px repeat(4,1fr);
        gap: 3px;
        align-items: center;
        margin-bottom: 3px;
        font-size: 11px;
    }

    .cb-rgrid input {
        width: 100%;
        padding: 2px 3px;
        border: 1px solid #c8a84e;
        border-radius: 3px;
        background: #fdf6e0;
        color: #3a2800;
        font-size: 11px;
        text-align: center;
    }

    .cb-rhdr {
        color: #7a5a10;
        font-weight: bold;
        text-align: center;
        font-size: 10px;
    }

    #cb-float {
        position: fixed !important;
        bottom: 10px !important;
        right: 10px !important;
        z-index: 2147483646 !important;
        background: linear-gradient(90deg,#8a5a10,#c4922a);
        border: none;
        border-radius: 8px;
        color: #fff;
        font-family: Arial,sans-serif;
        font-size: 13px;
        font-weight: bold;
        padding: 8px 14px;
        cursor: pointer;
        box-shadow: 0 3px 12px rgba(0,0,0,.4);
        text-shadow: 0 1px 2px rgba(0,0,0,.4);
    }
    `;

    function buildPanel() {
        if (document.getElementById('cb-panel')) return;

        const ratioRows = Object.keys(RATIOS).map(function(k) {
            return `
                <div class="cb-rgrid" data-unit="${k}">
                    <div style="font-size:11px;color:#5a3a00">${TROOP_NAMES[k]}</div>
                    <input type="number" step="0.01" min="1" value="${RATIOS[k].mica}" data-slot="mica">
                    <input type="number" step="0.01" min="1" value="${RATIOS[k].medie}" data-slot="medie">
                    <input type="number" step="0.01" min="1" value="${RATIOS[k].mare}" data-slot="mare">
                    <input type="number" step="0.01" min="1" value="1" data-slot="extrema" disabled style="opacity:.5">
                </div>
            `;
        }).join('');

        const panel = document.createElement('div');
        panel.id = 'cb-panel';

        panel.innerHTML = `
            <div id="cb-header">
                <span id="cb-header-title">⚔ Distributie Curatare</span>
                <button id="cb-close">✕</button>
            </div>

            <div id="cb-body">
                <div id="cb-slots-container">
                    <div style="color:#7a5a10;font-size:12px;padding:4px 0">
                        Apasa <b>Calculeaza</b> pentru distributie.
                    </div>
                </div>

                <div id="cb-status"></div>

                <button id="cb-btn-calc">⚔ Calculeaza distributia</button>
                <button id="cb-btn-fill">▶ Incepe completarea</button>
                <button id="cb-toggle-settings">⚙ Editeaza raporturi per trupa</button>
            </div>

            <div id="cb-settings">
                <div class="cb-stitle">Raporturi - Extrema = 1x</div>
                <div class="cb-rgrid" style="margin-bottom:5px">
                    <div></div>
                    <div class="cb-rhdr">Mica</div>
                    <div class="cb-rhdr">Medie</div>
                    <div class="cb-rhdr">Mare</div>
                    <div class="cb-rhdr">Ext.</div>
                </div>
                ${ratioRows}
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('cb-close').addEventListener('click', function() {
            panel.remove();
        });

        makeDraggable(panel, document.getElementById('cb-header'));

        let settingsOpen = false;

        document.getElementById('cb-toggle-settings').addEventListener('click', function() {
            settingsOpen = !settingsOpen;
            document.getElementById('cb-settings').style.display = settingsOpen ? 'block' : 'none';
        });

        document.getElementById('cb-btn-calc').addEventListener('click', function() {
            const all = getScavengeOptions();

            const active = all.filter(function(o) {
                return !o.locked;
            });

            const troops = readTroops();

            console.log('[Curatare] Trupe disponibile:', troops);
            console.log('[Curatare] Curatari active:', active.map(a => a.key));

            if (!active.length) {
                updateStatus('⚠ Nu s-au gasit curatari deblocate.', 'error');
                return;
            }

            const total = Object.keys(troops).reduce(function(s, k) {
                return s + troops[k];
            }, 0);

            if (!total) {
                updateStatus('⚠ Nu s-au gasit trupe disponibile. Deschide F12 > Console si trimite-mi ce apare la [Curatare].', 'error');
                return;
            }

            const customRatios = {};

            document.querySelectorAll('#cb-settings .cb-rgrid[data-unit]').forEach(function(row) {
                const unit = row.getAttribute('data-unit');
                customRatios[unit] = {};

                row.querySelectorAll('input[data-slot]').forEach(function(inp) {
                    customRatios[unit][inp.getAttribute('data-slot')] = parseFloat(inp.value) || 1;
                });
            });

            lastResult = calculate(troops, active, customRatios);
            lastActive = active;
            lastAll = all;

            renderSlots(lastResult, all, null);

            updateStatus(
                '✓ ' + total.toLocaleString() + ' trupe gasite | ' + active.length + ' curatari deblocate',
                'info'
            );

            const btn = document.getElementById('cb-btn-fill');
            btn.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '▶ Incepe completarea';
        });

        document.getElementById('cb-btn-fill').addEventListener('click', function() {
            if (!lastResult || !lastActive) {
                updateStatus('⚠ Mai intai apasa Calculeaza distributia.', 'error');
                return;
            }

            const btn = document.getElementById('cb-btn-fill');
            btn.style.display = 'none';

            const queue = [];

            FILL_ORDER.forEach(function(key) {
                lastActive.forEach(function(opt) {
                    if (opt.key === key && !opt.locked) {
                        queue.push(opt);
                    }
                });
            });

            console.log('[Curatare] Ordine completare:', queue.map(q => q.key));

            startSequence(queue);
        });
    }

    function addFloatButton() {
        if (document.getElementById('cb-float')) return;

        const btn = document.createElement('button');
        btn.id = 'cb-float';
        btn.textContent = '⚔ Curatare';

        btn.addEventListener('click', function() {
            const ex = document.getElementById('cb-panel');

            if (ex) {
                ex.remove();
                return;
            }

            buildPanel();
        });

        document.body.appendChild(btn);
    }

    function injectCSS() {
        if (document.getElementById('cb-style')) return;

        const style = document.createElement('style');
        style.id = 'cb-style';
        style.textContent = CSS;

        document.head.appendChild(style);
    }

    function tryInit() {
        injectCSS();
        addFloatButton();

        if (isScavengePage()) {
            buildPanel();
        }
    }

    if (document.readyState === 'complete') {
        setTimeout(tryInit, 1000);
    } else {
        window.addEventListener('load', function() {
            setTimeout(tryInit, 1000);
        });
    }

    let lastUrl = window.location.href;

    setInterval(function() {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;

            setTimeout(function() {
                const ex = document.getElementById('cb-panel');

                if (ex) ex.remove();

                tryInit();
            }, 1200);
        }
    }, 1000);

})();
