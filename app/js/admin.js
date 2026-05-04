import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const firebaseConfig = {
  apiKey: "AIzaSyB-3wuIEOqpnnAqWiBYuSTEp1is_n76DEg",
  authDomain: "balpha-9dab9.firebaseapp.com",
  projectId: "balpha-9dab9",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

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

  const role = userSnap.data().role;

  if (!["admin", "superadmin"].includes(role)) {
    window.location.href = "../index.html";
    return;
  }

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


function init() {
console.log("INIT RUNNING");
const page = document.body.dataset.page;

const table = document.getElementById("usersTable");
const modal = document.getElementById("userModal");
const saveBtn = document.getElementById("saveUser");
const addBtn = document.getElementById("addUserBtn");

let editId = null;

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

      row.innerHTML = `
        <td>${renderRow(data)}</td>
        <td>
          <button class="edit-btn">Edit</button>
          <button class="delete-btn">Delete</button>
        </td>
      `;

      row.querySelector(".edit-btn").onclick = () => {
        editId = docSnap.id;
        const page = document.body.dataset.page;
        const merged = deepMerge(structuredClone(schemas[page]), data);
        openModal(merged);
      };

      row.querySelector(".delete-btn").onclick = async () => {
        if (!confirm("Delete?")) return;

        await deleteDoc(doc(db, page, docSnap.id));
        loadData();
      };

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
    return `${data.email} (${data.role})`;
  }

  if (page === "plants") {
    return `${data.metadata?.naziv || "-"} (${data.metadata?.sorta || "-"})`;
  }

  if (page === "entries") {
    return `${data.type || "-"} - ${data.note || "-"}`;
  }

  if (page === "tenants") {
    return `${data.naziv || "-"} (${data.status || "-"})`;
  }

  return JSON.stringify(data);
}


// ADD
// =======================
addBtn.onclick = () => {
  editId = null;
  openModal({});
};


// MODAL FORM
// =======================
function openModal(data) {
  modal.classList.add("open");

  modal.innerHTML = `
    <div class="modal-content">
      <h3>${editId ? "Edit" : "Add"} ${page}</h3>

      ${generateForm(data)}

      <button id="saveDynamic">Save</button>
    </div>
  `;

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

function generateForm(data, parentKey = "") {
  let html = "";

  for (const key in data) {
    const value = data[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "object" && value !== null) {
      html += `<div style="margin-top:10px;"><strong>${key}</strong></div>`;
      html += generateForm(value, fullKey);
    } else {
      html += `
        <input 
          data-key="${fullKey}" 
          value="${value ?? ""}" 
          placeholder="${fullKey}"
          style="margin-bottom:6px; width:100%;"
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

  if (!isNaN(val)) return Number(val);

  if (val === "true") return true;
  if (val === "false") return false;

  return val;
}


// =======================
loadData();
}