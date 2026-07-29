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


const firebaseConfig = {
  apiKey: "AIzaSyB-3wuIEOqpnnAqWiBYuSTEp1is_n76DEg",
  authDomain: "balpha-9dab9.firebaseapp.com",
  projectId: "balpha-9dab9",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function normalizeUserRole(role) {
  const r = String(role == null ? '' : role).trim().toLowerCase();
  if (!r) return 'user';
  if (r === 'supadmin' || r === 'super-admin' || r === 'super_admin') return 'superadmin';
  return r;
}

function isAdminPanelRole(role) {
  const r = normalizeUserRole(role);
  return r === 'admin' || r === 'superadmin';
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

  if (!isAdminPanelRole(role) && role !== 'viewer') {
    window.location.href = "../index.html";
    return;
  }

  if (role === "viewer") {
    window.location.href = "../index.html?view=plants";
    return;
  }

  window.__adminPanelRole = role;
  window.__adminReadOnly = role === "admin";

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
  banner.textContent = "Read-only view of the superadmin database — editing is not allowed.";
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

      const actionsCell = readOnly
        ? `<button type="button" class="btn btn-ghost btn-sm view-btn">View</button>`
        : `<button type="button" class="btn btn-ghost btn-sm edit-btn">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm delete-btn">Delete</button>`;

      row.innerHTML = `
        <td>${renderRow(data)}</td>
        <td>${actionsCell}</td>
      `;

      if (readOnly) {
        row.querySelector(".view-btn").onclick = () => {
          const page = document.body.dataset.page;
          const merged = deepMerge(structuredClone(schemas[page]), data);
          openModal(merged, true);
        };
      } else {
        row.querySelector(".edit-btn").onclick = () => {
          editId = docSnap.id;
          const page = document.body.dataset.page;
          const merged = deepMerge(structuredClone(schemas[page]), data);
          openModal(merged, false);
        };

        row.querySelector(".delete-btn").onclick = async () => {
          const label =
            page === "users"
              ? String(data.email || "this user")
              : "this " + page.replace(/s$/, "");
          if (
            !confirm(
              "Delete " +
                label +
                "?\n\nThis cannot be undone from the admin tools."
            )
          ) {
            return;
          }

          await deleteDoc(doc(db, page, docSnap.id));
          loadData();
        };
      }

      table.appendChild(row);
    });

    setTimeout(hideLoading, 300);

  } catch (err) {
    console.error("LOAD ERROR:", err);
  }
}

// DISPLAY FORMAT
// =======================
function renderRow(data) {
  if (page === "users") {
    return (
      `<span class="admin-users-email">${esc(data.email || "—")}</span>` +
      `<span class="admin-users-role">${esc(data.role || "user")}</span>`
    );
  }

  if (page === "plants") {
    return `${esc(data.metadata?.naziv || "-")} (${esc(data.metadata?.sorta || "-")})`;
  }

  if (page === "entries") {
    return `${esc(data.type || "-")} - ${esc(data.note || "-")}`;
  }

  if (page === "tenants") {
    return `${esc(data.naziv || "-")} (${esc(data.status || "-")})`;
  }

  return esc(JSON.stringify(data));
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

  modal.innerHTML = `
    <div class="modal-content">
      <h3>${readOnly ? "View" : editId ? "Edit" : "Add"} ${page}</h3>

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