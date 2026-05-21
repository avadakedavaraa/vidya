/**
 * js/availability-manager.js
 * Handles the multi-step broadcasting wizard and weekly availability UI.
 */

const AvailabilityManager = {
  // --- BROADCAST WIZARD ---
  async openBroadcastWizard() {
    const skillName = document.getElementById("newSkillName")?.value || "";
    const category =
      document.getElementById("newSkillCategory")?.value || "other";

    if (!skillName.trim()) {
      alert("Please enter a skill name first!");
      return;
    }

    // Create modal
    const modal = document.createElement("div");
    modal.id = "broadcastWizard";
    modal.className = "wizard-overlay";
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);
      z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;
    `;

    modal.innerHTML = `
      <div class="wizard-card" style="background:var(--card); width: 100%; max-width: 500px; border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden; animation: wizardIn 0.3s ease-out;">
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-family:'DM Serif Display', serif; font-size: 1.25rem;">🚀 Broadcast to Teach</h3>
          <button onclick="document.getElementById('broadcastWizard').remove()" style="background:none; border:none; font-size: 1.5rem; cursor:pointer; color:var(--muted)">&times;</button>
        </div>
        
        <div id="wizardContent" style="padding: 2rem;">
          <!-- Step 1: Availability -->
          <div id="step-1">
            <h4 style="font-size: 1rem; margin-bottom: 0.5rem;">When are you free this week?</h4>
            <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 1.5rem;">Pick the slots you'd like to open for ${skillName}. You can create exceptions for weekends later.</p>
            
            <style>
              .wizard-scroll-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -0.5rem; padding: 0 0.5rem 0.5rem; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
              .wizard-scroll-wrap::-webkit-scrollbar { height: 4px; }
              .wizard-scroll-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
              .wiz-inner-grid { min-width: 480px; }
            </style>
            <div class="wizard-scroll-wrap"><div id="wizardGrid" class="wiz-inner-grid" style="display: grid; grid-template-columns: 100px repeat(7, 1fr); gap: 0.6rem; margin-bottom: 1rem; align-items: stretch;">
              <!-- Empty corner -->
              <div></div>
              <!-- Days labels -->
              ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => `<div style="text-align:center; font-size:0.75rem; font-weight:800; color: ${i === 0 || i === 6 ? "var(--danger)" : "var(--muted)"}; text-transform:uppercase;">${d}</div>`).join("")}
              
              <!-- Rows -->
              ${[
                {
                  label: "🌅 Morning",
                  range: "8am - 12pm",
                  start: "08:00",
                  end: "12:00",
                },
                {
                  label: "☀️ Mid-Day",
                  range: "12pm - 4pm",
                  start: "12:00",
                  end: "16:00",
                },
                {
                  label: "🌆 Evening",
                  range: "4pm - 9pm",
                  start: "16:00",
                  end: "21:00",
                },
                {
                  label: "🌙 Late Night",
                  range: "9pm - 12am",
                  start: "21:00",
                  end: "23:59",
                },
              ]
                .map((row, timeIdx) => {
                  return `
                  <div style="display:flex; flex-direction:column; justify-content:center; padding-right: 10px;">
                    <div style="font-size: 0.75rem; font-weight: 700; color: var(--ink); white-space:nowrap;">${row.label}</div>
                    <div style="font-size: 0.6rem; color: var(--muted); font-weight: 500;">${row.range}</div>
                  </div>
                  ${Array(7)
                    .fill(0)
                    .map((_, day) => {
                      const isWeekend = day === 0 || day === 6;
                      return `
                      <div class="wiz-slot ${isWeekend ? "weekend" : ""}" 
                           data-day="${day}" data-time-start="${row.start}" data-time-end="${row.end}"
                           onclick="this.classList.toggle('selected')"
                           style="aspect-ratio: 1.2; border-radius: 10px; background: var(--surface); border: 1.5px solid var(--border); cursor:pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; position:relative;">
                        <span class="check-icon" style="display:none; font-size: 1rem;">✅</span>
                      </div>
                    `;
                    })
                    .join("")}
                `;
                })
                .join("")}
            </div></div>

            <style>
              .wiz-slot { position: relative; overflow: hidden; }
              .wiz-slot:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(22, 162, 123, 0.15); }
              .wiz-slot.selected { background: var(--primary-light); border-color: var(--primary); }
              .wiz-slot.selected .check-icon { display: block !important; z-index: 2; }
              .wiz-slot.weekend { background: rgba(0,0,0,0.03); }
              [data-theme="dark"] .wiz-slot.weekend { background: rgba(255,255,255,0.03); }
              @keyframes wizardIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            </style>

            <div style="display:flex; justify-content: flex-end; gap: 0.75rem;">
              <button onclick="document.getElementById('broadcastWizard').remove()" class="th-btn outline" style="color:var(--ink); border-color:var(--border)">Cancel</button>
              <button onclick="AvailabilityManager.wizardStep2('${skillName.replace(/'/g, "\\'")}', '${category}')" class="th-btn primary" style="background:var(--primary); color:#fff">Next Step &rarr;</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  wizardStep2(skillName, category) {
    const selected = Array.from(
      document.querySelectorAll(".wiz-slot.selected"),
    );
    if (selected.length === 0) {
      alert("Please select at least one slot!");
      return;
    }

    const content = document.getElementById("wizardContent");
    content.innerHTML = `
      <div id="step-2">
        <h4 style="font-size: 1rem; margin-bottom: 0.5rem;">Confirm & Notify</h4>
        <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 1.5rem;">We'll notify students looking to learn <strong>${skillName}</strong>. Add a quick note about your availability:</p>
        
        <textarea id="availNote" style="width:100%; height: 80px; padding: 0.8rem; border-radius: 12px; border: 1.5px solid var(--border); background: var(--surface); color: var(--ink); font-family: inherit; font-size: 0.88rem; outline: none; margin-bottom: 1.5rem;" placeholder="e.g. Free most evenings after 6 PM..."></textarea>

        <div style="display:flex; justify-content: space-between; align-items: center;">
          <button onclick="AvailabilityManager.openBroadcastWizard()" style="background:none; border:none; color:var(--muted); font-size: 0.85rem; cursor:pointer;">&larr; Back</button>
          <button id="finalBroadcastBtn" onclick="AvailabilityManager.finalizeBroadcast('${skillName.replace(/'/g, "\\'")}', '${category}')" class="th-btn primary" style="background:var(--primary); color:#fff">🚀 Broadcast Now</button>
        </div>
      </div>
    `;
  },

  async finalizeBroadcast(skillName, category) {
    const btn = document.getElementById("finalBroadcastBtn");
    const note = document.getElementById("availNote").value;
    const slots = Array.from(
      document.querySelectorAll(".wiz-slot.selected"),
    ).map((el) => {
      const day = parseInt(el.dataset.day);
      const startTime = el.dataset.timeStart + ":00";
      const endTime = el.dataset.timeEnd + ":00";
      return { day_of_week: day, start_time: startTime, end_time: endTime };
    });

    try {
      btn.disabled = true;
      btn.textContent = "Broadcasting...";

      // 1. Broadcast skill
      const res = await VS.teachers.broadcast(skillName, category);
      if (!res.qualified) {
        alert("You need to pass the MCQ verification for this skill first!");
        document.getElementById("broadcastWizard").remove();
        return;
      }

      // 2. Save availability
      await VS.teachers.saveWeeklyAvailability(slots);

      // 3. Notify learners
      const notify = await VS.teachers.notifyMatchingLearners(
        skillName,
        note || "Check my profile for slots.",
      );

      // Success!
      document.getElementById("wizardContent").innerHTML = `
        <div style="text-align:center; padding: 1rem;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
          <h4 style="font-size: 1.25rem; margin-bottom: 0.5rem;">Broadcast Successful!</h4>
          <p style="font-size: 0.88rem; color: var(--muted); margin-bottom: 1.5rem;">Notified ${notify.count} matching learners. You're now listed as a teacher for ${skillName}.</p>
          <button onclick="location.reload()" class="th-btn primary" style="background:var(--primary); color:#fff; width:100%">Go to Dashboard</button>
        </div>
      `;
    } catch (err) {
      alert("Error: " + err.message);
      btn.disabled = false;
      btn.textContent = "🚀 Broadcast Now";
    }
  },

  // --- AVAILABILITY TAB UI ---
  async renderAvailabilityTab(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
      const userId = localStorage.getItem("vs_user_id");
      const [slots, stats] = await Promise.all([
        VS.teachers.getWeeklyAvailability(userId).catch(() => []),
        VS.teachers.myStats().catch(() => ({ skills: [] })),
      ]);

      let skillsHtml = `
        <div class="card" style="margin-bottom: 2rem; border-left: 4px solid var(--border);">
          <div class="card-title">🚀 Active Teaching Broadcasts</div>
          <p style="font-size: 0.82rem; color: var(--muted); margin-bottom: 1.2rem;">You are currently visible to students for these subjects:</p>
          <div class="empty" style="padding: 1rem; text-align:center; background: var(--surface); border-radius: 12px; font-size: 0.82rem; color: var(--muted);">
            No active teaching broadcasts found. <br/>
            <span style="font-size: 0.72rem;">Use the <b>"Broadcast to Teach"</b> wizard to list yourself as a teacher.</span>
          </div>
        </div>
      `;

      if (stats.skills && stats.skills.length > 0) {
        skillsHtml = `
          <div class="card" style="margin-bottom: 2rem; border-left: 4px solid var(--primary);">
            <div class="card-title">🚀 Active Teaching Broadcasts</div>
            <p style="font-size: 0.82rem; color: var(--muted); margin-bottom: 1.2rem;">You are currently visible to students for the following subjects (click to edit):</p>
            <div style="display: flex; flex-wrap: wrap; gap: 0.75rem;">
              ${stats.skills
                .map(
                  (s) => `
                <div onclick="AvailabilityManager.openEditSkillModal('${s.id}', '${s.name.replace(/'/g, "\\'")}', '${s.category}', ${s.coin_rate})" 
                     class="broadcast-pill-item"
                     style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:0.8rem 1.2rem; display:flex; flex-direction:column; gap:0.25rem; min-width:160px; cursor:pointer; transition:all 0.2s;">
                  <span style="font-size:0.9rem; font-weight:700; color:var(--ink);">${s.name}</span>
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 0.2rem;">
                    <span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase; font-weight:600;">${s.category}</span>
                    <span style="font-size:0.85rem; font-weight:700; color:var(--primary);">🪙 ${s.coin_rate}/hr</span>
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
            <style>
              .broadcast-pill-item:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(22, 162, 123, 0.1); }
            </style>
            <div style="margin-top: 1.2rem; font-size: 0.75rem; color: var(--muted);">
              💡 Click any subject above to quickly edit its details or timings.
            </div>
          </div>
        `;
      }

      let html = `
        ${skillsHtml}
        <div class="card" style="margin-bottom: 2rem;">
          <div class="card-title">📅 Weekly Recurring Schedule</div>
          <p style="font-size: 0.82rem; color: var(--muted); margin-bottom: 1.2rem;">These slots repeat every week and are shown to students on your profile.</p>
          
          <style>
            .avail-scroll-wrap {
              overflow-x: auto;
              -webkit-overflow-scrolling: touch;
              margin: 0 -0.5rem;
              padding: 0 0.5rem 0.75rem;
              scrollbar-width: thin;
              scrollbar-color: var(--border) transparent;
            }
            .avail-scroll-wrap::-webkit-scrollbar { height: 4px; }
            .avail-scroll-wrap::-webkit-scrollbar-track { background: transparent; }
            .avail-scroll-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
            .avail-day-grid {
              display: grid;
              grid-template-columns: repeat(7, minmax(90px, 1fr));
              gap: 0.75rem;
              min-width: 640px;
            }
          </style>

          <div class="avail-scroll-wrap">
            <div class="avail-day-grid">
              ${[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ]
                .map((day, i) => {
                  const daySlots = slots.filter((s) => s.day_of_week === i);
                  const isWeekend = i === 0 || i === 6;
                  return `
                  <div style="display:flex; flex-direction:column; gap:0.5rem;">
                    <div style="font-size:0.72rem; font-weight:700; color: ${isWeekend ? "var(--danger)" : "var(--ink)"}; text-align:center; margin-bottom:0.25rem; white-space:nowrap;">${day}</div>
                    <div id="day-slots-${i}" style="display:flex; flex-direction:column; gap:0.35rem; flex:1;">
                      ${daySlots
                        .map(
                          (s) => `
                        <div style="padding:0.35rem 0.3rem; background:var(--surface); border:1px solid var(--border); border-radius:6px; font-size:0.65rem; text-align:center; font-family:'JetBrains Mono', monospace; white-space:nowrap;">
                          ${s.start_time.substring(0, 5)}&thinsp;–&thinsp;${s.end_time.substring(0, 5)}
                        </div>
                      `,
                        )
                        .join("")}
                      ${daySlots.length === 0 ? '<div style="font-size:0.65rem; color:var(--muted); text-align:center; font-style:italic; padding: 0.4rem 0;">No slots</div>' : ""}
                    </div>
                    <button onclick="AvailabilityManager.addSlotPrompt(${i})" style="padding:0.35rem 0.25rem; border:1px dashed var(--border); background:none; border-radius:6px; font-size:0.65rem; color:var(--primary); cursor:pointer; white-space:nowrap;">+ Add</button>
                  </div>
                `;
                })
                .join("")}
            </div>
          </div>
          
          <div style="margin-top: 1.25rem; display: flex; justify-content: flex-end;">
             <button onclick="AvailabilityManager.clearAllAvailability()" class="th-btn outline" style="font-size:0.75rem; color:var(--danger); border-color:var(--danger)">Clear All</button>
          </div>
        </div>
      `;
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="empty">Failed to load availability: ${err.message}</div>`;
    }
  },

  async addSlotPrompt(day) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayName = days[day];

    // Create modal
    const modal = document.createElement("div");
    modal.id = "addSlotModal";
    modal.className = "wizard-overlay";
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px);
      z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 20px;
    `;

    modal.innerHTML = `
      <div class="wizard-card" style="background:var(--card); width: 100%; max-width: 400px; border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden; animation: wizardIn 0.3s ease-out;">
        <div style="padding: 1.25rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-family:'DM Serif Display', serif; font-size: 1.15rem;">🕒 Add Slot for ${dayName}</h3>
          <button onclick="document.getElementById('addSlotModal').remove()" style="background:none; border:none; font-size: 1.25rem; cursor:pointer; color:var(--muted)">&times;</button>
        </div>
        
        <div style="padding: 1.5rem;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
            <div>
              <label for="slotStart" style="display:block; font-size:0.7rem; font-weight:700; color:var(--muted); margin-bottom:0.4rem; text-transform:uppercase;">Start Time</label>
              <input id="slotStart" type="time" value="09:00" style="width:100%; padding:0.7rem; border-radius:10px; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-size:0.9rem; outline:none;">
            </div>
            <div>
              <label for="slotEnd" style="display:block; font-size:0.7rem; font-weight:700; color:var(--muted); margin-bottom:0.4rem; text-transform:uppercase;">End Time</label>
              <input id="slotEnd" type="time" value="10:00" style="width:100%; padding:0.7rem; border-radius:10px; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-size:0.9rem; outline:none;">
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap: 0.75rem;">
            <button id="confirmSlotBtn" onclick="AvailabilityManager.confirmAddSlot(${day})" class="th-btn primary" style="background:var(--primary); color:#fff; width:100%">Add to Schedule</button>
            <button onclick="document.getElementById('addSlotModal').remove()" class="th-btn outline" style="width:100%; color:var(--muted); border-color:var(--border)">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  async confirmAddSlot(day) {
    const start = document.getElementById("slotStart").value;
    const end = document.getElementById("slotEnd").value;
    const btn = document.getElementById("confirmSlotBtn");

    if (!start || !end) return;
    if (start >= end) {
      alert("Start time must be before end time.");
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Adding...";

      const userId = localStorage.getItem("vs_user_id");
      const current = await VS.teachers.getWeeklyAvailability(userId);
      const next = [
        ...current.map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
        { day_of_week: day, start_time: `${start}:00`, end_time: `${end}:00` },
      ];

      await VS.teachers.saveWeeklyAvailability(next);

      document.getElementById("addSlotModal").remove();
      this.renderAvailabilityTab("availabilityTabContent");
      if (typeof showToast !== "undefined") showToast("📅", "Time slot added!");
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Add to Schedule";
      alert(e.message);
    }
  },

  async clearAllAvailability() {
    if (confirm("Clear all your weekly slots?")) {
      await VS.teachers.saveWeeklyAvailability([]);
      this.renderAvailabilityTab("availabilityTabContent");
    }
  },

  // --- EDIT SKILL MODAL ---
  async openEditSkillModal(skillId, skillName, category, coinRate) {
    // Create modal
    const modal = document.createElement("div");
    modal.id = "editSkillModal";
    modal.className = "wizard-overlay";
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px);
      z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;
    `;

    // Fetch current availability to show in modal
    let currentSlots = [];
    try {
      const userId = localStorage.getItem("vs_user_id");
      currentSlots = await VS.teachers.getWeeklyAvailability(userId);
    } catch (e) {
      console.warn("Failed to fetch slots for edit:", e);
    }

    const isSlotActive = (day, start, end) => {
      return currentSlots.some(
        (s) =>
          s.day_of_week === day &&
          s.start_time.startsWith(start) &&
          s.end_time.startsWith(end),
      );
    };

    modal.innerHTML = `
      <div class="wizard-card" style="background:var(--card); width: 100%; max-width: 600px; border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 20px 40px rgba(0,0,0,0.2); overflow: hidden; animation: wizardIn 0.3s ease-out;">
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-family:'DM Serif Display', serif; font-size: 1.25rem;">✏️ Edit Broadcast</h3>
          <button onclick="document.getElementById('editSkillModal').remove()" style="background:none; border:none; font-size: 1.5rem; cursor:pointer; color:var(--muted)">&times;</button>
        </div>
        
        <div style="padding: 1.5rem; max-height: 80vh; overflow-y: auto;">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
            <div>
              <label for="editSkillName" style="display:block; font-size:0.75rem; font-weight:700; color:var(--muted); margin-bottom:0.4rem; text-transform:uppercase;">Subject Name</label>
              <input id="editSkillName" type="text" value="${skillName}" style="width:100%; padding:0.8rem; border-radius:10px; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-size:0.9rem; outline:none; focus:border-color:var(--primary);">
            </div>
            <div>
              <label for="editSkillRate" style="display:block; font-size:0.75rem; font-weight:700; color:var(--muted); margin-bottom:0.4rem; text-transform:uppercase;">Hourly Rate (Coins)</label>
              <input id="editSkillRate" type="number" value="${coinRate}" step="0.5" style="width:100%; padding:0.8rem; border-radius:10px; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-size:0.9rem; outline:none;">
            </div>
            <div style="grid-column: 1/-1;">
              <label for="editSkillCategory" style="display:block; font-size:0.75rem; font-weight:700; color:var(--muted); margin-bottom:0.4rem; text-transform:uppercase;">Category</label>
              <select id="editSkillCategory" style="width:100%; padding:0.8rem; border-radius:10px; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-size:0.9rem; outline:none;">
                <option value="programming" ${category === "programming" ? "selected" : ""}>💻 Programming & Tech</option>
                <option value="design" ${category === "design" ? "selected" : ""}>🎨 Design & Arts</option>
                <option value="language" ${category === "language" ? "selected" : ""}>🗣️ Languages</option>
                <option value="academics" ${category === "academics" ? "selected" : ""}>📚 Academics</option>
                <option value="music" ${category === "music" ? "selected" : ""}>🎸 Music & Performance</option>
                <option value="other" ${category === "other" ? "selected" : ""}>✨ Other</option>
              </select>
            </div>
          </div>

          <h4 style="font-size: 0.9rem; margin-bottom: 0.75rem; font-weight: 700;">Update Weekly Timings</h4>
          <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -0.5rem; padding: 0 0.5rem 0.5rem; scrollbar-width: thin;"><div id="editWizardGrid" style="display: grid; grid-template-columns: 90px repeat(7, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; align-items: stretch; min-width: 480px;">
            <div></div>
            ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => `<div style="text-align:center; font-size:0.65rem; font-weight:800; color: ${i === 0 || i === 6 ? "var(--danger)" : "var(--muted)"}; text-transform:uppercase;">${d}</div>`).join("")}
            
            ${[
              {
                label: "🌅 Morning",
                range: "8am-12pm",
                start: "08:00",
                end: "12:00",
              },
              {
                label: "☀️ Mid-Day",
                range: "12pm-4pm",
                start: "12:00",
                end: "16:00",
              },
              {
                label: "🌆 Evening",
                range: "4pm-9pm",
                start: "16:00",
                end: "21:00",
              },
              {
                label: "🌙 Night",
                range: "9pm-12am",
                start: "21:00",
                end: "23:59",
              },
            ]
              .map((row, timeIdx) => {
                return `
                <div style="display:flex; flex-direction:column; justify-content:center;">
                  <div style="font-size: 0.65rem; font-weight: 700; color: var(--ink); line-height: 1;">${row.label}</div>
                  <div style="font-size: 0.55rem; color: var(--muted);">${row.range}</div>
                </div>
                ${Array(7)
                  .fill(0)
                  .map((_, day) => {
                    const isActive = isSlotActive(day, row.start, row.end);
                    return `
                    <div class="wiz-slot edit-wiz-slot ${isActive ? "selected" : ""}" 
                         data-day="${day}" data-time-start="${row.start}" data-time-end="${row.end}"
                         onclick="this.classList.toggle('selected'); const check = this.querySelector('.check-icon'); check.style.display = this.classList.contains('selected') ? 'block' : 'none';"
                         style="aspect-ratio: 1.1; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); cursor:pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                      <span class="check-icon" style="display:${isActive ? "block" : "none"}; font-size: 0.8rem;">✅</span>
                    </div>
                  `;
                  })
                  .join("")}
              `;
              })
              .join("")}
          </div></div>

          <style>
            .edit-wiz-slot.selected { background: var(--primary-light) !important; border-color: var(--primary) !important; }
            .edit-wiz-slot:hover { border-color: var(--primary); transform: translateY(-1px); }
          </style>

          <div style="display:flex; justify-content: flex-end; gap: 0.75rem; margin-top: 2rem;">
            <button onclick="document.getElementById('editSkillModal').remove()" class="th-btn outline" style="color:var(--ink); border-color:var(--border)">Discard</button>
            <button id="saveEditBtn" onclick="AvailabilityManager.saveSkillEdit('${skillId}')" class="th-btn primary" style="background:var(--primary); color:#fff; padding: 0.8rem 2rem;">Save Changes</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  async saveSkillEdit(skillId) {
    const btn = document.getElementById("saveEditBtn");
    const name = document.getElementById("editSkillName").value;
    const cat = document.getElementById("editSkillCategory").value;
    const rate = parseFloat(document.getElementById("editSkillRate").value);

    const slots = Array.from(
      document.querySelectorAll(".edit-wiz-slot.selected"),
    ).map((el) => {
      return {
        day_of_week: parseInt(el.dataset.day),
        start_time: el.dataset.timeStart + ":00",
        end_time: el.dataset.timeEnd + ":00",
      };
    });

    try {
      btn.disabled = true;
      btn.textContent = "Saving...";

      // 1. Update Skill info
      await VS.teachers.updateSkill(skillId, {
        name: name.trim(),
        category: cat,
        coin_rate: rate,
      });

      // 2. Update Availability
      await VS.teachers.saveWeeklyAvailability(slots);

      if (typeof showToast !== "undefined")
        showToast("✅", "Broadcast updated successfully!");
      else alert("Broadcast updated!");

      document.getElementById("editSkillModal").remove();
      if (typeof initTeacherDashboard === "function") initTeacherDashboard();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Save Changes";
      alert("Save failed: " + err.message);
    }
  },
};

window.AvailabilityManager = AvailabilityManager;
