/* Next Living · Nút "Liên hệ" và khung nhắn tin cho website.
 * Dán vào website:  <script src="https://neo-nestly.vercel.app/lien-he.js" charset="utf-8" defer></script>
 * Nội dung (Messenger, Zalo, số gọi, giờ tư vấn, bật / tắt) chỉnh trong app: Quản trị → Cài đặt website → Nút Liên hệ.
 * Tin nhắn khách gửi vào app, mục Phản ánh & tin nhắn, dạng "SĐT: tin nhắn". Khách phải nhập số điện thoại trước khi gửi.
 * Chạy trong Shadow DOM để không đụng giao diện của website chủ. Không dùng cookie; chỉ lưu mã cuộc trò chuyện trên trình duyệt. */
(function () {
  if (window.__nlLienHe) return; window.__nlLienHe = true;
  var SB = "https://nbxnupvceeyqqwrabjfc.supabase.co";
  var KEY = "sb_publishable_hETTG4G-xty-xj1rm2B3NQ_fILjnDux";
  var me = document.currentScript;
  var APP = (function () { try { return new URL(me && me.src ? me.src : location.href).origin; } catch (e) { return "https://neo-nestly.vercel.app"; } })();
  var onApp = location.origin === APP && /^\/phong(\/|$)/.test(location.pathname);
  var TK = "nl_chat_token";
  var store = {
    get: function () { try { return localStorage.getItem(TK) || ""; } catch (e) { return ""; } },
    set: function (v) { try { v ? localStorage.setItem(TK, v) : localStorage.removeItem(TK); } catch (e) { /* trình duyệt chặn lưu */ } },
  };

  function rpc(fn, args) {
    return fetch(SB + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {}),
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.message) || "Không gửi được, vui lòng thử lại.");
        return j;
      });
    });
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "on") for (var ev in attrs.on) n.addEventListener(ev, attrs.on[ev]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(path, fill) {
    var w = document.createElement("span"); w.className = "ic";
    w.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="' + (fill || "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + "</svg>";
    return w;
  }
  var IC = {
    chat: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    msg: '<path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.3S17 3 12 3z"/><path d="M7.5 13l3-3 2.5 2 3.5-3"/>',
    zalo: '<rect x="3" y="4" width="18" height="15" rx="5"/><path d="M8 9.5h4l-4 5h4M15 9.5v5"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  };

  var CSS = [
    ":host{all:initial}",
    ".w{--b:#3D7A4B;--bi:#fff;--bs:#E0EFDC;--s:#fff;--s2:#F4F8F2;--i:#1B2A1F;--m:#5C6B60;--l:#D5E2D1;--e:#B3402F;",
    "font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--i)}",
    "@media (prefers-color-scheme:dark){.w{--b:#8CC99A;--bi:#0E1A11;--bs:#1E3323;--s:#161E18;--s2:#1B241D;--i:#E3ECE4;--m:#98A89B;--l:#2B372D;--e:#EE8270}}",
    ".fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;",
    "background:var(--b);color:var(--bi);font:700 15px/1 inherit;letter-spacing:.02em;padding:12px 18px 12px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22)}",
    ".fab:focus-visible,.it:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--b);outline-offset:2px}",
    ".pn{position:fixed;right:16px;bottom:76px;z-index:2147483000;width:min(380px,calc(100vw - 24px));max-height:min(640px,calc(100vh - 100px));",
    "display:flex;flex-direction:column;background:var(--s);border:1px solid var(--l);border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25)}",
    "[hidden]{display:none!important}",
    ".hd{display:flex;align-items:center;gap:10px;padding:14px 14px 14px 16px;background:var(--b);color:var(--bi)}",
    ".hd b{flex:1;font-size:16px;text-transform:uppercase;letter-spacing:.02em}",
    ".hd button{background:transparent;border:0;color:inherit;cursor:pointer;padding:4px;border-radius:8px;display:grid;place-items:center}",
    ".bd{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px;background:var(--s2)}",
    ".it{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--s);border:1px solid var(--l);border-radius:12px;color:var(--i);text-decoration:none;cursor:pointer;text-align:left;font:inherit;width:100%;box-sizing:border-box}",
    ".it:hover{border-color:var(--b)}",
    ".it .ic{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--bs);color:var(--b)}",
    ".it .ic.ms{background:#E7E4FB;color:#5B3FD6}.it .ic.zl{background:#E3EEFC;color:#0068FF}",
    "@media (prefers-color-scheme:dark){.it .ic.ms{background:#2A2540;color:#B4A6FF}.it .ic.zl{background:#17283F;color:#7DB2FF}}",
    ".it span.t{display:flex;flex-direction:column;gap:1px;min-width:0}",
    ".it span.t b{font-size:15.5px}.it span.t small{color:var(--m);font-size:13.5px}",
    ".chat{display:flex;flex-direction:column;gap:8px}",
    ".msg{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;font-size:14.5px}",
    ".msg.khach{align-self:flex-end;background:var(--b);color:var(--bi);border-bottom-right-radius:4px}",
    ".msg.cong_ty{align-self:flex-start;background:var(--s);border:1px solid var(--l);border-bottom-left-radius:4px}",
    ".msg.he_thong{align-self:center;color:var(--m);font-size:13px;background:transparent}",
    ".msg small{display:block;opacity:.75;font-size:11.5px;margin-top:2px}",
    ".note{color:var(--m);font-size:13.5px;margin:0}",
    ".err{color:var(--e);font-size:13.5px;margin:0}",
    "form{display:flex;flex-direction:column;gap:8px;padding:12px;border-top:1px solid var(--l);background:var(--s)}",
    "label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--m)}",
    "input,textarea{font:inherit;font-size:16px;color:var(--i);background:var(--s);border:1px solid var(--l);border-radius:10px;padding:9px 11px;box-sizing:border-box;width:100%}",
    "textarea{min-height:64px;resize:vertical}",
    ".row{display:flex;gap:8px;align-items:center}",
    ".go{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:10px;background:var(--b);color:var(--bi);font:700 15px/1 inherit;padding:12px;cursor:pointer}",
    ".go[disabled]{opacity:.55;cursor:default}",
    ".lnk{background:transparent;border:0;color:var(--b);font:600 13.5px inherit;cursor:pointer;padding:4px}",
    "@media (max-width:480px){.pn{right:8px;bottom:72px}.fab{right:12px;bottom:12px}}",
  ].join("");

  rpc("web_config").then(function (c) {
    c = c || {};
    if (c.contact_on === false) return;
    var hours = c.contact_hours ? " (" + c.contact_hours + ")" : "";
    var chatOn = c.chat_on !== false;
    var items = [];
    if (chatOn) items.push({ kind: "chat", icon: IC.chat, title: "Nhắn tin cho Next Living", sub: "Trả lời trong giờ làm việc" + hours });
    if (c.messenger) items.push({ href: "https://m.me/" + encodeURIComponent(c.messenger), icon: IC.msg, cls: "ms", title: "Liên hệ Messenger", sub: hours.trim() });
    if (c.zalo) items.push({ href: "https://zalo.me/" + String(c.zalo).replace(/\D/g, ""), icon: IC.zalo, cls: "zl", title: "Liên hệ Zalo", sub: hours.trim() });
    if (c.hotline) items.push({ href: "tel:" + String(c.hotline).replace(/[\s.]/g, ""), icon: IC.phone, title: (c.hotline_label || "Gọi thuê phòng") + hours, sub: c.hotline });
    if (c.hotline2) items.push({ href: "tel:" + String(c.hotline2).replace(/[\s.]/g, ""), icon: IC.help, title: (c.hotline2_label || "Gọi hỗ trợ khách thuê") + hours, sub: c.hotline2 });
    if (!onApp) items.push({ href: APP + "/phong", icon: IC.home, title: "Xem phòng trống", sub: "Ảnh, giá và đặt lịch xem phòng", blank: true });
    if (!items.length) return;
    build(c, items, chatOn);
  }).catch(function () { /* không tải được cài đặt thì không hiện nút */ });

  function build(c, items, chatOn) {
    var host = el("div", { id: "next-living-lien-he" });
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    root.appendChild(el("style", { text: CSS }));
    var w = el("div", { class: "w" });
    root.appendChild(w);

    var title = c.contact_title || "Liên hệ để được tư vấn";
    var fab = el("button", { class: "fab", type: "button", "aria-expanded": "false", "aria-controls": "nl-pn" }, [svg(IC.chat), "LIÊN HỆ"]);
    var pn = el("div", { class: "pn", id: "nl-pn", role: "dialog", "aria-label": title, hidden: "" });
    w.appendChild(pn); w.appendChild(fab);

    var view = "menu", timer = null;
    function open(v) { pn.hidden = false; fab.setAttribute("aria-expanded", "true"); render(v || view); }
    function close() { pn.hidden = true; fab.setAttribute("aria-expanded", "false"); stopPoll(); fab.focus(); }
    fab.addEventListener("click", function () { pn.hidden ? open("menu") : close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pn.hidden) close(); });
    function stopPoll() { if (timer) { clearInterval(timer); timer = null; } }

    function head(text, back) {
      return el("div", { class: "hd" }, [
        back ? el("button", { type: "button", "aria-label": "Quay lại", on: { click: function () { render("menu"); } } }, [svg(IC.back)]) : svg(IC.chat),
        el("b", { text: text }),
        el("button", { type: "button", "aria-label": "Đóng", on: { click: close } }, [svg(IC.x)]),
      ]);
    }

    function render(v) {
      view = v; stopPoll();
      pn.textContent = "";
      if (v === "menu") {
        pn.appendChild(head(title));
        var bd = el("div", { class: "bd" });
        items.forEach(function (it) {
          var kids = [svg(it.icon), el("span", { class: "t" }, [el("b", { text: it.title }), it.sub ? el("small", { text: it.sub }) : null])];
          if (it.cls) kids[0].className = "ic " + it.cls;
          bd.appendChild(it.kind === "chat"
            ? el("button", { type: "button", class: "it", on: { click: function () { render("chat"); } } }, kids)
            : el("a", { class: "it", href: it.href, target: it.href.indexOf("tel:") === 0 ? null : "_blank", rel: "noopener" }, kids));
        });
        pn.appendChild(bd);
        return;
      }
      chatView();
    }

    function roomId() {
      if (!onApp) return null;
      var m = location.pathname.match(/^\/phong\/([0-9a-f-]{36})/);
      return m ? m[1] : null;
    }

    function chatView() {
      pn.appendChild(head("Nhắn tin cho Next Living", true));
      var bd = el("div", { class: "bd" });
      var list = el("div", { class: "chat", "aria-live": "polite" });
      bd.appendChild(list);
      pn.appendChild(bd);
      var token = store.get();
      var phone = "";
      var err = el("p", { class: "err", role: "alert" });
      var f = el("form", { novalidate: "" });
      var inPhone = el("input", { type: "tel", inputmode: "tel", autocomplete: "tel", maxlength: "15", placeholder: "Ví dụ 0909 123 456", required: "" });
      var inName = el("input", { type: "text", autocomplete: "name", maxlength: "60", placeholder: "Không bắt buộc" });
      var inText = el("textarea", { maxlength: "1000", placeholder: "Bạn cần thuê phòng ở đâu, giá bao nhiêu, khi nào vào ở?", required: "" });
      var btn = el("button", { class: "go", type: "submit" }, [svg(IC.send), "Gửi"]);
      var phoneRow = el("label", null, ["Số điện thoại di động *", inPhone]);
      var nameRow = el("label", null, ["Tên của bạn", inName]);

      function paint(data) {
        list.textContent = "";
        var greet = c.chat_greeting || "Chào bạn! Để lại số điện thoại và tin nhắn, Next Living sẽ trả lời ở đây và gọi lại cho bạn.";
        list.appendChild(el("div", { class: "msg cong_ty", text: greet }));
        if (data && data.messages) data.messages.forEach(function (m) {
          var t = new Date(m.at);
          var when = t.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
          list.appendChild(el("div", { class: "msg " + m.sender }, [m.body, el("small", { text: (m.sender === "cong_ty" ? "Next Living · " : "") + when })]));
        });
        if (data && data.status === "dong") list.appendChild(el("div", { class: "msg he_thong", text: "Cuộc trò chuyện đã kết thúc. Gửi tin mới để bắt đầu lại." }));
        bd.scrollTop = bd.scrollHeight;
      }
      function load() {
        if (!token) { paint(null); return Promise.resolve(); }
        return rpc("web_chat_get", { p_token: token }).then(function (d) {
          if (!d) { token = ""; store.set(""); phone = ""; }
          else { phone = d.phone || ""; if (d.status === "dong") { token = ""; store.set(""); } }
          paint(d); layout();
        }).catch(function () { paint(null); });
      }
      function layout() {
        phoneRow.hidden = !!token; nameRow.hidden = !!token;
        newBtn.hidden = !token;
      }
      var newBtn = el("button", { type: "button", class: "lnk", text: "Cuộc mới", on: { click: function () { token = ""; phone = ""; store.set(""); paint(null); layout(); inPhone.focus(); } } });

      f.appendChild(phoneRow); f.appendChild(nameRow);
      f.appendChild(el("label", null, ["Tin nhắn *", inText]));
      f.appendChild(err);
      f.appendChild(el("div", { class: "row" }, [btn, newBtn]));
      f.appendChild(el("p", { class: "note", text: "Số điện thoại chỉ dùng để Next Living liên hệ lại về việc thuê phòng." }));
      f.addEventListener("submit", function (e) {
        e.preventDefault(); err.textContent = "";
        var ph = token ? phone : inPhone.value.replace(/\D/g, "").replace(/^84(?=\d{9}$)/, "0");
        var tx = inText.value.trim();
        if (!/^0[35789]\d{8}$/.test(ph)) { err.textContent = "Vui lòng nhập số điện thoại di động 10 số trước khi gửi."; inPhone.focus(); return; }
        if (!tx) { err.textContent = "Bạn chưa nhập tin nhắn."; inText.focus(); return; }
        btn.disabled = true;
        rpc("web_chat_send", { p_token: token || null, p_phone: ph, p_text: tx, p_name: inName.value.trim() || null, p_room: roomId() })
          .then(function (r) { token = r.token; store.set(token); phone = ph; inText.value = ""; return load(); })
          .catch(function (x) { err.textContent = x.message; })
          .then(function () { btn.disabled = false; });
      });
      pn.appendChild(f);
      layout(); load();
      if (!chatOn) return;
      timer = setInterval(function () { if (token && !pn.hidden) load(); }, 20000);
      setTimeout(function () { (token ? inText : inPhone).focus(); }, 30);
    }
  }
})();
