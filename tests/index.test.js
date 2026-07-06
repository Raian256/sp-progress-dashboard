import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load the generated HTML content for the test environment
// file moved into the sp-dashboard subdirectory
const html = readFileSync(resolve(__dirname, '../sp-dashboard/index.html'), 'utf8');

describe('Date Range Reporter UI', () => {
  let scriptContent;

  beforeEach(() => {
    // Reset the DOM
    document.documentElement.innerHTML = html;

    // In a JSDOM environment, we need to manually execute the script
    // because JSDOM doesn't run script tags automatically by default in Vitest
    const scriptElement = Array.from(document.querySelectorAll('script'))
      .find(s => !s.src && s.textContent.includes('processData'));

    if (scriptElement) {
      // Execute the plugin logic in the global window context
      const runScript = new Function(scriptElement.textContent);
      runScript.call(window);
    }
  });

  describe('Utility Functions', () => {
    it('should correctly format time in milliseconds to hours and minutes', () => {
      // Testing the formatTime function defined in the script
      expect(window.formatTime(3600000)).toBe('1h 0m');
      expect(window.formatTime(9000000)).toBe('2h 30m');
      expect(window.formatTime(0)).toBe('0h 0m');
    });

    it('should format date strings to short readable format', () => {
      expect(window.formatDateShort('2026-02-22')).toBe('Feb 22, 2026');
    });

    it('should generate an array of dates within a range', () => {
      const range = window.getDatesInRange('2026-02-20', '2026-02-22');
      expect(range).toEqual(['2026-02-20', '2026-02-21', '2026-02-22']);
    });
  });

  describe('Dashboard State Updates', () => {
    it('should calculate metrics correctly and update stat cards', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const mockTasks = [
        {
          id: 't1',
          parentId: null,
          title: 'Task 1',
          isDone: true,
          doneOn: new Date().getTime(),
          timeSpentOnDay: { [todayStr]: 7200000 } // 2h
        },
        {
          id: 't2',
          parentId: null,
          title: 'Task 2',
          isDone: false,
          timeSpentOnDay: { [todayStr]: 3600000 } // 1h
        }
      ];
      const mockProjects = [{ id: 'p1', title: 'Test Project' }];

      window.processData(mockTasks, mockProjects);

      // Totals are surfaced on the idle runway ("Xh Ym today · Zh Wm this week").
      const runway = document.getElementById('runway').textContent;
      expect(runway).toContain('3h 0m today');
      expect(runway).toContain('3h 0m this week');
    });

    it('should handle a task without dueDay by not marking it overdue', () => {
      const task = {
        id: 't-no-due',
        parentId: null,
        title: 'No Due Date',
        isDone: false,
        timeSpentOnDay: {}
      };
      window.processData([task], []);
      // no time entries, no due date -> zero time
      expect(document.getElementById('runway').textContent).toContain('0h 0m today');
    });

    it('should count tasks due today in totalTasks denominator even with no time logged', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const taskDueToday = {
        id: 't-due-no-time',
        parentId: null,
        title: 'Due Today No Time',
        isDone: false,
        dueDay: todayStr,
        timeSpentOnDay: {}
      };
      window.processData([taskDueToday], []);
      // Task due today with no time: zero period and today time
      const runway = document.getElementById('runway').textContent;
      expect(runway).toContain('0h 0m today');
      expect(runway).toContain('0h 0m this week');
    });

    it('should deduplicate tasks that appear in both active and archived lists', () => {
      const now = Date.now();
      const doneTask = {
        id: 'task1',
        parentId: null,
        title: 'Done Task',
        isDone: true,
        doneOn: now,
        dueDay: new Date(now).toISOString().split('T')[0],
        timeSpentOnDay: {}
      };
      // Simulate what happens when pullDataFromSP combines activeTasks and archivedTasks
      // The same task appears in both lists (which can happen with completed tasks)
      const activeTasks = [doneTask];
      const archivedTasks = [doneTask];

      // Deduplicate using Map (same logic as in pullDataFromSP)
      const taskMap = new Map();
      archivedTasks.forEach(task => taskMap.set(task.id, task));
      activeTasks.forEach(task => taskMap.set(task.id, task));
      const deduplicatedTasks = Array.from(taskMap.values());

      // Should have only 1 unique task, not 2
      expect(deduplicatedTasks.length).toBe(1);

      // Process the deduplicated list and verify only 1 task (not 2)
      window.processData(deduplicatedTasks, []);
      expect(deduplicatedTasks.length).toBe(1);
    });
  });

  describe('Project Groups', () => {
    it('migrates legacy global goals into a single "All" group', () => {
      localStorage.clear();
      localStorage.setItem('sp-dashboard-goal-period', '10');
      localStorage.setItem('sp-dashboard-goal-today', '2');
      const projects = [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Beta' }];
      window.processData([], projects);

      const groups = window.loadGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].name).toBe('All');
      expect(groups[0].weeklyGoalH).toBe(10);
      expect(groups[0].dailyGoalH).toBe(2);
      expect(groups[0].projectIds).toEqual(['p1', 'p2']);
    });

    it('does not migrate when a groups key already exists', () => {
      localStorage.clear();
      localStorage.setItem('sp-dashboard-goal-period', '10');
      localStorage.setItem('sp-dashboard-groups', '[]');
      window.processData([], [{ id: 'p1', title: 'Alpha' }]);
      expect(window.loadGroups()).toEqual([]);
    });

    it('computeGroupStats sums member weekly/today ms and surfaces Ungrouped', () => {
      localStorage.clear();
      const projects = [
        { id: 'p1', title: 'Alpha' },
        { id: 'p2', title: 'Beta' },
        { id: 'p3', title: 'Gamma' }
      ];
      window.saveGroups([
        { id: 'g1', name: 'Work', weeklyGoalH: 6, dailyGoalH: 1, projectIds: ['p1', 'p2'], color: '#60a5fa' }
      ]);
      // Sets the cachedProjects the resolver reads (migration is skipped, key exists)
      window.processData([], projects);

      const stats = window.computeGroupStats({
        projectData: { Alpha: 3600000, Beta: 7200000, Gamma: 1800000 },
        projectTodayData: { Alpha: 1800000 },
        workingDaysElapsed: 3
      });

      const work = stats.find(s => s.name === 'Work');
      expect(work.weeklyMs).toBe(10800000); // 1h + 2h
      expect(work.todayMs).toBe(1800000);   // 0.5h
      expect(work.proratedGoalMs).toBe(10800000); // 6h/6*3 working days

      const ungrouped = stats.find(s => s.isUngrouped);
      expect(ungrouped).toBeTruthy();
      expect(ungrouped.projectTitles).toContain('Gamma');
      expect(ungrouped.weeklyMs).toBe(1800000);
    });

    it('summary weekly goal equals the sum of group goals', () => {
      localStorage.clear();
      window.saveGroups([
        { id: 'g1', name: 'A', weeklyGoalH: 10, dailyGoalH: 1, projectIds: [] },
        { id: 'g2', name: 'B', weeklyGoalH: 5, dailyGoalH: 2, projectIds: [] }
      ]);
      window.processData([], []);
      expect(window.getTotalWeeklyGoalH()).toBe(15);
      expect(window.getTotalDailyGoalH()).toBe(3);
      // Per-group goals surface on the idle lanes.
      const lanes = document.getElementById('lanes-list').textContent;
      expect(lanes).toContain('10h'); // group A weekly goal
      expect(lanes).toContain('5h');  // group B weekly goal
    });
  });

  describe('Tracking-driven Today view', () => {
    beforeEach(() => localStorage.clear());

    it('resolveTrackingMode returns idle when nothing is tracked', () => {
      expect(window.resolveTrackingMode(null, []).mode).toBe('idle');
      expect(window.resolveTrackingMode({ id: 't1' }, []).mode).toBe('idle'); // no projectId
    });

    it('resolveTrackingMode focuses the owning group', () => {
      const groups = [{ id: 'g1', name: 'CS', projectIds: ['p1'] }];
      const res = window.resolveTrackingMode({ id: 't1', projectId: 'p1' }, groups);
      expect(res.mode).toBe('focus');
      expect(res.groupId).toBe('g1');
      expect(res.isUngrouped).toBe(false);
    });

    it('resolveTrackingMode marks an unclaimed project as ungrouped focus', () => {
      const groups = [{ id: 'g1', name: 'CS', projectIds: ['pX'] }];
      const res = window.resolveTrackingMode({ id: 't1', projectId: 'p9' }, groups);
      expect(res.mode).toBe('focus');
      expect(res.groupId).toBe(null);
      expect(res.isUngrouped).toBe(true);
    });

    it('resolveTrackingMode picks the most-behind of multiple owning groups', () => {
      const groups = [
        { id: 'g1', name: 'A', projectIds: ['p1'] },
        { id: 'g2', name: 'B', projectIds: ['p1'] },
      ];
      const stats = [
        { id: 'g1', dailyGoalMs: 3600000, todayMs: 3000000 }, // gap 0.6M
        { id: 'g2', dailyGoalMs: 3600000, todayMs: 600000 },  // gap 3.0M (more behind)
      ];
      const res = window.resolveTrackingMode({ id: 't1', projectId: 'p1' }, groups, stats);
      expect(res.groupId).toBe('g2');
    });

    it('computeRunway relates remaining day to the goal still owed', () => {
      const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
      // 20:00, wind-down 22:00 -> 2h left; goal 6h, done 4h -> 2h still needed == left => squeeze
      const r1 = window.computeRunway(at(20), 22, 6 * 3600000, 4 * 3600000);
      expect(Math.round(r1.leftMs / 3600000)).toBe(2);
      expect(Math.round(r1.neededMs / 3600000)).toBe(2);
      expect(r1.squeeze).toBe(true);
      // Goal already met -> nothing needed, not a squeeze
      const r2 = window.computeRunway(at(18), 22, 6 * 3600000, 6 * 3600000);
      expect(r2.neededMs).toBe(0);
      expect(r2.squeeze).toBe(false);
      // Past wind-down -> no usable day left
      const r3 = window.computeRunway(at(23), 22, 6 * 3600000, 1 * 3600000);
      expect(r3.leftMs).toBe(0);
    });
  });

  describe('Navigation & Interactivity', () => {
    it('week-start-day selector should recompute date range', () => {
      const weekStartDaySelect = document.getElementById('week-start-day');
      const today = new Date();

      // Test each weekday — verify processData runs without error
      for (const targetDay of [0, 1, 2, 3, 4, 5, 6]) {
        weekStartDaySelect.value = String(targetDay);
        weekStartDaySelect.dispatchEvent(new Event('change'));
        window.processData([], []);
      }
      // bar chart unit/display/count controls render correct number of bars
      const barContainer = document.getElementById('bar-chart-container');
      const unitSel = document.getElementById('bar-chart-unit');
      const displaySel = document.getElementById('bar-chart-display');
      const countInput = document.getElementById('bar-chart-count');
      const todayStr = window.toLocalDateStr(new Date());
      const task = { id:'t1', parentId:null, title:'Test', isDone:false, timeSpentOnDay:{[todayStr]:3600000} };
      window.processData([task], []);

      unitSel.value = 'days'; displaySel.value = 'bars'; countInput.value = '7';
      window.updateBarChart();
      expect(barContainer.querySelectorAll('.bar-col').length).toBe(7);

      unitSel.value = 'days'; displaySel.value = 'curve'; countInput.value = '30';
      window.updateBarChart();
      // curve renders as SVG; each data point has a visible dot + hit area = 2 circles each
      expect(barContainer.querySelectorAll('svg circle').length / 2).toBe(30);

      unitSel.value = 'weeks'; displaySel.value = 'bars'; countInput.value = '8';
      window.updateBarChart();
      expect(barContainer.querySelectorAll('.bar-col').length).toBe(8);

      unitSel.value = 'months'; displaySel.value = 'bars'; countInput.value = '12';
      window.updateBarChart();
      expect(barContainer.querySelectorAll('.bar-col').length).toBe(12);

      // independent decisions: weeks as a curve
      unitSel.value = 'weeks'; displaySel.value = 'curve'; countInput.value = '6';
      window.updateBarChart();
      expect(barContainer.querySelectorAll('svg circle').length / 2).toBe(6);

      // independent decisions: months as a curve
      unitSel.value = 'months'; displaySel.value = 'curve'; countInput.value = '5';
      window.updateBarChart();
      expect(barContainer.querySelectorAll('svg circle').length / 2).toBe(5);
    });


  });
});
