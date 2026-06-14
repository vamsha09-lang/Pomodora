import express from "express";
import cors from "cors";
import fs from "fs";
import { nanoid } from "nanoid";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

if (!fs.existsSync("data")) {
  fs.mkdirSync("data");
}

const defaults = {
  settings: {
    focusDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    interval: 4,
    autoBreak: false,
    autoPomo: false,
    countUp: false,
    alarm: "bell",
    theme: "aurora",
    volume: 80
  },
  projects: [],
  tasks: [],
  history: []
};

function ensure(name, value) {
  const path = `data/${name}.json`;
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(value, null, 2));
  }
}

Object.entries(defaults).forEach(([k, v]) => ensure(k, v));

function read(name) {
  return JSON.parse(
    fs.readFileSync(`data/${name}.json`, "utf8")
  );
}

function write(name, data) {
  fs.writeFileSync(
    `data/${name}.json`,
    JSON.stringify(data, null, 2)
  );
}

/* SETTINGS */

app.get("/api/settings", (req, res) => {
  res.json(read("settings"));
});

app.put("/api/settings", (req, res) => {
  write("settings", req.body);
  res.json({ success: true });
});

/* PROJECTS */

app.get("/api/projects", (req, res) => {
  res.json(read("projects"));
});

app.post("/api/projects", (req, res) => {
  const projects = read("projects");

  const project = {
    id: nanoid(),
    ...req.body
  };

  projects.push(project);
  write("projects", projects);

  res.json(project);
});

app.put("/api/projects/:id", (req, res) => {
  let projects = read("projects");

  projects = projects.map(p =>
    p.id === req.params.id
      ? { ...p, ...req.body }
      : p
  );

  write("projects", projects);

  res.json({ success: true });
});

app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;

  write(
    "projects",
    read("projects").filter(p => p.id !== id)
  );

  write(
    "tasks",
    read("tasks").filter(t => t.projectId !== id)
  );

  res.json({ success: true });
});

/* TASKS */

app.get("/api/tasks", (req, res) => {
  res.json(read("tasks"));
});

app.post("/api/tasks", (req, res) => {
  const tasks = read("tasks");

  const task = {
    id: nanoid(),
    completed: false,
    pomoDone: 0,
    ...req.body
  };

  tasks.push(task);
  write("tasks", tasks);

  res.json(task);
});

app.delete("/api/tasks/:id", (req, res) => {
  write(
    "tasks",
    read("tasks").filter(
      t => t.id !== req.params.id
    )
  );

  res.json({ success: true });
});

/* HISTORY */

app.get("/api/history", (req, res) => {
  res.json(read("history"));
});

app.post("/api/history/seed", (req, res) => {
  if (read("history").length > 0) {
    return res.json({ success: true });
  }

  const sample = [
    {
      date: new Date().toISOString(),
      duration: 25,
      projectId: null
    }
  ];

  write("history", sample);

  res.json({ success: true });
});

/* SESSIONS */

app.post("/api/sessions", (req, res) => {
  const history = read("history");

  history.push({
    id: nanoid(),
    date: new Date().toISOString(),
    ...req.body
  });

  write("history", history);

  if (req.body.taskId) {
    const tasks = read("tasks");

    const updated = tasks.map(t =>
      t.id === req.body.taskId
        ? {
            ...t,
            pomoDone: (t.pomoDone || 0) + 1
          }
        : t
    );

    write("tasks", updated);
  }

  res.json({ success: true });
});

/* STATS */

function buildStats(period) {
  const history = read("history");

  const byDay = {};
  const byProject = {};

  let total = 0;
  let minutes = 0;

  history.forEach(h => {
    const day = h.date.slice(0, 10);

    byDay[day] = (byDay[day] || 0) + 1;

    if (h.projectId) {
      byProject[h.projectId] =
        (byProject[h.projectId] || 0) + 1;
    }

    total++;
    minutes += h.duration || 25;
  });

  const dates = Object.keys(byDay).sort();

  return {
    total,
    minutes,
    dailyAvg: dates.length
      ? Math.round(total / dates.length)
      : 0,
    streak: dates.length,
    dates,
    byDay,
    byProject
  };
}

app.get("/api/stats/:period", (req, res) => {
  res.json(buildStats(req.params.period));
});

app.listen(PORT, () => {
  console.log(
    `🚀 PomoBalance running on port ${PORT}`
  );
});
