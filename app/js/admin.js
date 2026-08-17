import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js";


const firebaseConfig = {
  apiKey: "AIzaSyB-3wuIEOqpnnAqWiBYuSTEp1is_n76DEg",
  authDomain: "balpha-9dab9.firebaseapp.com",
  projectId: "balpha-9dab9",
};

const app = initializeApp(firebaseConfig);
// Must follow initializeApp; no-op until a site key is configured. Set by the
// classic script js/appcheck-config.js, which runs before this module.
try {
  if (window.growtooAppCheckEnabled && window.growtooAppCheckEnabled()) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(window.GROWTOO_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (err) {
  console.warn('App Check init skipped', err);
}
const db = getFirestore(app);
const auth = getAuth(app);

const ADMIN_PANEL_EMAILS = ['supadmin@dnevnik.live', 'admin@dnevnik.live'];

function normalizeUserRole(role) {
  const r = String(role == null ? '' : role).trim().toLowerCase();
  if (!r) return 'user';
  if (r === 'supadmin' || r === 'super-admin' || r === 'super_admin') return 'superadmin';
  return r;
}

function isAllowedAdminEmail(email) {
  return ADMIN_PANEL_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
}

function isAdminPanelRole(role, email) {
  const r = normalizeUserRole(role);
  if (r !== 'admin' && r !== 'superadmin') return false;
  return isAllowedAdminEmail(email);
}

// HTML-escape any value before interpolating it into innerHTML. Firestore
// documents in `plants`/`entries`/`users` can contain user-supplied strings
// (plant names, journal notes, emails, etc.) — never trust them as markup.
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

onAuthStateChanged(auth, async (user) => {
  console.log("AUTH:", user);

  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists()) {
    console.log("User doc missing");
    return;
  }

  const role = normalizeUserRole(userSnap.data().role);
  const email = user.email || '';

  // Viewers are not admins. Growers with a mistaken privileged role stay out.
  if (role === 'viewer') {
    window.location.href = '../index.html?view=plants';
    return;
  }

  if (!isAdminPanelRole(role, email)) {
    window.location.href = '../index.html';
    return;
  }

  window.__adminPanelRole = role;
  window.__adminReadOnly = role === 'admin';

  init();
});

function hideLoading() {
  const el = document.getElementById("loading-screen");
  if (!el) return;

  el.classList.add("loading-hidden");

  setTimeout(() => {
    el.remove();
  }, 300);
}

const schemas = {
  users: {
    email: "",
    role: "user",
    createdAt: "",
    status: "",
    tenantId: "",
    uId: ""
  },

  plants: {
    count: 0,
    metadata: {
      temp: "",
      naziv: "",
      ownerUid: "",
      plantId: "",
      sorta: "",
      stage: "",
      tenantId: ""
    }
  },

  entries: {
    createdAt: "",
    date: "",
    entryId: "",
    type: "",
    metadata: {
      temp: "",
      ownerUid: "",
      plantId: "",
      tenantId: ""
    }
  },

  tenants: {
    createdAt: "",
    limits: "",
    naziv: "",
    status: "",
    tenantId: ""
  }
};


function canAdminPanelEdit() {
  return normalizeUserRole(window.__adminPanelRole) === "superadmin";
}

function init() {
console.log("INIT RUNNING");
const page = document.body.dataset.page;
const readOnly = !!window.__adminReadOnly;

const table = document.getElementById("usersTable");
const modal = document.getElementById("userModal");
const saveBtn = document.getElementById("saveUser");
const addBtn = document.getElementById("addUserBtn");

let editId = null;

if (readOnly) {
  document.body.classList.add("admin-readonly");
  const banner = document.createElement("div");
  banner.className = "admin-readonly-banner";
  /* This runs at module top level, before the dictionary has loaded, so the
     T() call would freeze in English. The data-i18n attribute lets the i18n
     runtime translate it as soon as the dictionary lands. */
  banner.setAttribute("data-i18n", "app.admin.readOnly");
  banner.textContent = T(
    "app.admin.readOnly",
    "Read-only view of the superadmin database — editing is not allowed."
  );
  document.body.insertBefore(banner, document.body.firstChild);
  if (addBtn) addBtn.style.display = "none";
}

function deepMerge(target, source) {
  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
// LOAD DATA
// =======================
async function loadData() {
  try {
    console.log("LOADING DATA...");
    console.log("PAGE:", page);

    if (!page) {
      console.error("No page defined (data-page missing)");
      return;
    }

    if (!table) {
      console.error("Table element not found");
      return;
    }

    table.innerHTML = "";

    const snap = await getDocs(collection(db, page));

    console.log("DOC COUNT:", snap.size);

    snap.forEach(docSnap => {
      const data = docSnap.data();

      const row = document.createElement("tr");
      const labelCell = document.createElement("td");
      // Never pipe user-controlled Firestore strings through innerHTML.
      renderRowInto(labelCell, data);
      row.appendChild(labelCell);

      const actionsCell = document.createElement("td");
      if (readOnly) {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "btn btn-ghost btn-sm view-btn";
        viewBtn.textContent = T("app.admin.view", "View");
        viewBtn.onclick = () => {
          const page = document.body.dataset.page;
          const merged = deepMerge(structuredClone(schemas[page]), data);
          openModal(merged, true);
        };
        actionsCell.appendChild(viewBtn);
      } else {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btn btn-ghost btn-sm edit-btn";
        editBtn.textContent = T("app.admin.edit", "Edit");
        editBtn.onclick = () => {
          editId = docSnap.id;
          const page = document.body.dataset.page;
          const merged = deepMerge(structuredClone(schemas[page]), data);
          openModal(merged, false);
        };
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn btn-ghost btn-sm delete-btn";
        deleteBtn.textContent = T("app.admin.delete", "Delete");
        deleteBtn.onclick = async () => {
          const label =
            page === "users"
              ? String(data.email || T("app.admin.thisUser", "this user"))
              : T("app.admin.thisRecord", "this record");
          if (
            !confirm(
              T("app.admin.confirmDelete", "Delete {label}?", { label: label }) +
                "\n\n" +
                T("app.admin.deleteWarning", "This cannot be undone from the admin tools.")
            )
          ) {
            return;
          }

          await deleteDoc(doc(db, page, docSnap.id));
          loadData();
        };
        actionsCell.appendChild(editBtn);
        actionsCell.appendChild(deleteBtn);
      }
      row.appendChild(actionsCell);

      table.appendChild(row);
    });

    setTimeout(hideLoading, 300);

  } catch (err) {
    console.error("LOAD ERROR:", err);
  }
}

// DISPLAY FORMAT — DOM nodes / textContent only (no user HTML).
// =======================
function renderRowInto(cell, data) {
  cell.textContent = "";
  if (page === "users") {
    const email = document.createElement("span");
    email.className = "admin-users-email";
    email.textContent = data.email || "—";
    const role = document.createElement("span");
    role.className = "admin-users-role";
    role.textContent = data.role || "user";
    cell.appendChild(email);
    cell.appendChild(role);
    return;
  }

  if (page === "plants") {
    cell.textContent =
      (data.metadata?.naziv || "-") + " (" + (data.metadata?.sorta || "-") + ")";
    return;
  }

  if (page === "entries") {
    cell.textContent = (data.type || "-") + " - " + (data.note || "-");
    return;
  }

  if (page === "tenants") {
    cell.textContent = (data.naziv || "-") + " (" + (data.status || "-") + ")";
    return;
  }

  cell.textContent = JSON.stringify(data);
}


// ADD
// =======================
if (addBtn && canAdminPanelEdit()) {
  addBtn.onclick = () => {
    editId = null;
    openModal({}, false);
  };
}


// MODAL FORM
// =======================
function openModal(data, readOnly = false) {
  modal.classList.add("open");

  const safePage = esc(page);
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${readOnly ? "View" : editId ? "Edit" : "Add"} ${safePage}</h3>

      ${generateForm(data, "", readOnly)}

      <div class="modal-actions">
      ${
        readOnly
          ? `<button type="button" class="btn btn-primary" id="closeView">Close</button>`
          : `<button type="button" class="btn btn-ghost" id="cancelDynamic">Cancel</button>
             <button type="button" class="btn btn-primary" id="saveDynamic">Save</button>`
      }
      </div>
    </div>
  `;

  if (readOnly) {
    document.getElementById("closeView").onclick = () => modal.classList.remove("open");
    return;
  }

  const cancelBtn = document.getElementById("cancelDynamic");
  if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove("open");

  document.getElementById("saveDynamic").onclick = async () => {
    const formData = getFormDataDynamic();

    if (page === 'users') {
      const nextRole = normalizeUserRole(formData.role);
      const targetEmail = String(formData.email || '').trim().toLowerCase();
      if (
        (nextRole === 'admin' || nextRole === 'superadmin') &&
        !isAllowedAdminEmail(targetEmail)
      ) {
        alert(
          T(
            'app.admin.roleLimited',
            'Admin / superadmin roles are limited to supadmin@dnevnik.live and admin@dnevnik.live.'
          )
        );
        return;
      }
    }

    if (editId) {
      await updateDoc(doc(db, page, editId), formData);
    } else {
      await addDoc(collection(db, page), formData);
    }

    modal.classList.remove("open");
    loadData();
  };
}

function generateForm(data, parentKey = "", readOnly = false) {
  let html = "";

  for (const key in data) {
    const value = data[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "object" && value !== null) {
      html += `<div style="margin-top:10px;"><strong>${esc(key)}</strong></div>`;
      html += generateForm(value, fullKey, readOnly);
    } else {
      const safeVal = esc(value ?? "");
      html += `
        <input
          data-key="${esc(fullKey)}"
          value="${safeVal}"
          placeholder="${esc(fullKey)}"
          style="margin-bottom:6px; width:100%;"
          ${readOnly ? "readonly disabled" : ""}
        />
      `;
    }
  }

  return html;
}

function getFormDataDynamic() {
  const inputs = document.querySelectorAll("[data-key]");
  const result = {};

  inputs.forEach(input => {
    const keys = input.dataset.key.split(".");
    let current = result;

    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        current[k] = parseValue(input.value);
      } else {
        if (!current[k]) current[k] = {};
        current = current[k];
      }
    });
  });

  return result;
}

function parseValue(val) {
  if (val === "") return "";

  const trimmed = val.trim();
  // Numeric-looking strings only — and don't coerce things like "0791234567"
  // (phone numbers, batch codes) that have a meaningful leading zero.
  const looksNumeric =
    trimmed !== "" &&
    /^-?\d+(\.\d+)?$/.test(trimmed) &&
    !(trimmed.length > 1 && trimmed[0] === "0" && trimmed[1] !== ".");
  if (looksNumeric) return Number(trimmed);

  if (val === "true") return true;
  if (val === "false") return false;

  return val;
}


// =======================
loadData();
}