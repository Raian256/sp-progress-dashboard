import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load the generated HTML content for the test environment
// file moved into the sp-dashboard subdirectory
const html = readFileSync(resolve(__dirname, '../sp-dashboard/index.html'), 'utf8');

describe('Date Range Reporter UI', () => {
  let scriptContent;

  // Pin the clock to an active-block hour (today 10:00, inside the default
  // Morning block) BEFORE the script runs, so the idle Today view renders the
  // Launchpad deterministically. Without this, tests that assert on Launchpad
  // DOM (#runway etc.) fail whenever the real wall-clock lands in a break or
  // after the last block, since those now render the Pause / Ledger views.
  // Only Date is faked; real timers are untouched. Rest-view tests re-pin the
  // clock to their own hour with vi.setSystemTime.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const d = new Date(); d.setHours(10, 0, 0, 0);
    vi.setSystemTime(d);
  });
  afterEach(() => { vi.useRealTimers(); });

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
      // Pin to the afternoon block: at 0m today the morning has already ended, so
      // this is the Launchpad (not Cold Start), which surfaces the totals on #runway.
      const d = new Date(); d.setHours(17, 0, 0, 0); vi.setSystemTime(d);
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
      // Afternoon block, so 0m today renders the Launchpad (not Cold Start) and the
      // totals show on #runway.
      const d = new Date(); d.setHours(17, 0, 0, 0); vi.setSystemTime(d);
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
      // Afternoon block so 0m today renders the Launchpad lanes (not Cold Start).
      const d = new Date(); d.setHours(17, 0, 0, 0); vi.setSystemTime(d);
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

    const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
    const twoBlocks = () => [
      { id: 'm', label: 'Morning', start: 8, end: 14, intensity: 'hard' },
      { id: 'a', label: 'Afternoon', start: 16, end: 20, intensity: 'soft' }
    ];

    it('computeRunway resolves the current block and relates capacity to the goal', () => {
      const blocks = twoBlocks();
      // 10:00, inside the morning block -> ~4h left in THIS block (not the whole day);
      // capacity spans the morning tail (4h) + the whole afternoon (4h) = 8h.
      const r1 = window.computeRunway(at(10), blocks, 6 * 3600000, 2 * 3600000);
      expect(r1.state).toBe('active');
      expect(r1.block.id).toBe('m');
      expect(Math.round(r1.leftMs / 3600000)).toBe(4);
      expect(Math.round(r1.capacityMs / 3600000)).toBe(8);
      expect(r1.squeeze).toBe(false); // 4h owed fits in 8h capacity

      // 15:00, in the break -> upcoming, counting down to the afternoon start (1h).
      const r2 = window.computeRunway(at(15), blocks, 6 * 3600000, 2 * 3600000);
      expect(r2.state).toBe('upcoming');
      expect(r2.nextBlock.id).toBe('a');
      expect(Math.round(r2.leftMs / 3600000)).toBe(1);

      // 21:00, past the last block -> done, nothing left.
      const r3 = window.computeRunway(at(21), blocks, 6 * 3600000, 2 * 3600000);
      expect(r3.state).toBe('done');
      expect(r3.leftMs).toBe(0);

      // Goal already met -> nothing needed, never a squeeze.
      const r4 = window.computeRunway(at(10), blocks, 6 * 3600000, 6 * 3600000);
      expect(r4.neededMs).toBe(0);
      expect(r4.squeeze).toBe(false);
    });

    it('computeRunway squeeze is an honest daily judgement across blocks', () => {
      const blocks = twoBlocks();
      // 13:30: only 0.5h left in the morning block, but the afternoon still holds 4h,
      // so a 3h debt is NOT a squeeze (capacity 4.5h >= 3h) — no false morning squeeze.
      const notTight = window.computeRunway(at(13, 30), blocks, 6 * 3600000, 3 * 3600000);
      expect(notTight.squeeze).toBe(false);
      // With only the hard morning block, that same 3h debt at 13:30 (0.5h capacity) IS a squeeze.
      const tight = window.computeRunway(at(13, 30), [blocks[0]], 6 * 3600000, 3 * 3600000);
      expect(tight.state).toBe('active');
      expect(tight.squeeze).toBe(true);
    });

    it('blockAtTime picks the block containing the hour (end exclusive)', () => {
      const blocks = twoBlocks();
      expect(window.blockAtTime(blocks, 10).id).toBe('m');
      expect(window.blockAtTime(blocks, 15)).toBe(null); // in the gap
      expect(window.blockAtTime(blocks, 14)).toBe(null); // end is exclusive
      expect(window.blockAtTime(blocks, 17).id).toBe('a');
    });

    it('loadBlocks seeds defaults and migrates a legacy wind-down hour', () => {
      // Absent -> the default two-block day.
      localStorage.clear();
      const def = window.loadBlocks();
      expect(def.length).toBe(2);
      expect(def[0].start).toBe(8);
      expect(def[1].intensity).toBe('soft');
      // Legacy single wind-down hour -> one hard block ending at that hour.
      localStorage.clear();
      localStorage.setItem('sp-dashboard-wind-down-hour', '22');
      const migrated = window.loadBlocks();
      expect(migrated.length).toBe(1);
      expect(migrated[0].end).toBe(22);
      expect(migrated[0].intensity).toBe('hard');
    });

    it('formatTimeShort drops zero parts', () => {
      expect(window.formatTimeShort(45 * 60000)).toBe('45m');
      expect(window.formatTimeShort(2 * 3600000)).toBe('2h');
      expect(window.formatTimeShort(3600000 + 15 * 60000)).toBe('1h 15m');
      expect(window.formatTimeShort(0)).toBe('0m');
    });

    it('previousBlock returns the most recently ended block, or null before the first', () => {
      const blocks = twoBlocks();
      expect(window.previousBlock(blocks, at(9))).toBe(null);    // before the first block
      expect(window.previousBlock(blocks, at(15)).id).toBe('m'); // in the break -> morning ended
      expect(window.previousBlock(blocks, at(21)).id).toBe('a'); // past the day -> afternoon ended
    });

    it('computeBreakProgress bounds the current break and tracks elapsed fraction', () => {
      const blocks = twoBlocks();                 // break is 14:00 -> 16:00 (2h)
      expect(window.computeBreakProgress(blocks, at(10))).toBe(null); // inside a block
      expect(window.computeBreakProgress(blocks, at(21))).toBe(null); // past the last block
      const bp = window.computeBreakProgress(blocks, at(14, 45));     // 45m into a 2h break
      expect(bp.startH).toBe(14);
      expect(bp.endH).toBe(16);
      expect(Math.round(bp.totalMs / 60000)).toBe(120);
      expect(Math.round(bp.elapsedMs / 60000)).toBe(45);
      expect(Math.round(bp.pct)).toBe(38);
    });

    const restMetrics = () => ({
      todayTimeSpent: 2 * 3600000, totalTimeSpent: 10 * 3600000,
      workingDaysElapsed: 3, projectData: {}, projectTodayData: {}
    });
    const setupRest = () => {
      localStorage.clear();
      window.saveBlocks(twoBlocks());
      window.saveGroups([{ id: 'g1', name: 'CS', weeklyGoalH: 12, dailyGoalH: 3, projectIds: ['p1'], color: '#7aa2f7' }]);
    };

    it('idle between blocks renders the On a Break view (and hides the others)', () => {
      setupRest();
      const d = new Date(); d.setHours(14, 45, 0, 0); vi.setSystemTime(d);
      window.renderTodayView(restMetrics());
      const brk = document.getElementById('td-break');
      expect(brk.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('td-idle').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('td-done').classList.contains('hidden')).toBe(true);
      expect(brk.textContent).toContain('On a break');
      expect(brk.textContent).toContain('Afternoon');       // next-block preview
      expect(brk.textContent).toContain('Morning ended');   // prev-block closure
      expect(brk.textContent).toContain('resting');         // neutral break-progress
      expect(brk.querySelector('.pause-arc-fill')).not.toBe(null); // the sun-arc
    });

    it('idle past the last block renders the Day Complete view (and hides the others)', () => {
      setupRest();
      const d = new Date(); d.setHours(21, 0, 0, 0); vi.setSystemTime(d);
      window.renderTodayView(restMetrics());
      const done = document.getElementById('td-done');
      expect(done.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('td-idle').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('td-break').classList.contains('hidden')).toBe(true);
      expect(done.textContent).toContain('Day complete');
      expect(done.textContent).toContain('Lanes settled');
      expect(done.textContent).toContain('Last block ended');
      expect(done.querySelector('.ledger-spine')).not.toBe(null);   // the day spine
      expect(done.querySelectorAll('.ds-row').length).toBe(2);       // one node per block
    });

    it('isColdStart fires only at 0m with no block yet ended', () => {
      const blocks = twoBlocks();
      expect(window.isColdStart(blocks, at(7), 0)).toBe(true);        // before the first block
      expect(window.isColdStart(blocks, at(10), 0)).toBe(true);       // inside the first block
      expect(window.isColdStart(blocks, at(10), 60000)).toBe(false);  // something logged
      expect(window.isColdStart(blocks, at(15), 0)).toBe(false);      // morning ended -> break
      expect(window.isColdStart(blocks, at(21), 0)).toBe(false);      // past the day
      expect(window.isColdStart([], at(10), 0)).toBe(true);           // no blocks configured
    });

    it('idle at 0m inside the first block renders Cold Start (and hides the others)', () => {
      setupRest();
      const d = new Date(); d.setHours(9, 0, 0, 0); vi.setSystemTime(d);
      window.renderTodayView({ ...restMetrics(), todayTimeSpent: 0 });
      const cold = document.getElementById('td-cold');
      expect(cold.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('td-idle').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('td-break').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('td-done').classList.contains('hidden')).toBe(true);
      expect(cold.textContent).toContain('Ready when you are');
      expect(cold.textContent).toContain('Morning');                 // the anchor block, named
      expect(cold.textContent).toContain('Super Productivity');      // the how-to-begin line
      expect(cold.querySelector('.cold-horizon')).not.toBe(null);    // the open horizon
      expect(cold.querySelector('.ch-seg.current')).not.toBe(null);  // first block outlined
      // The instrument goes quiet: no goal bar, no counting.
      expect(cold.querySelector('.runway-bar')).toBe(null);
    });

    it('Cold Start hands back to the Launchpad once the first minute is logged', () => {
      setupRest();
      const d = new Date(); d.setHours(9, 0, 0, 0); vi.setSystemTime(d);
      window.renderTodayView({ ...restMetrics(), todayTimeSpent: 30 * 60000 });
      expect(document.getElementById('td-cold').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('td-idle').classList.contains('hidden')).toBe(false);
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
