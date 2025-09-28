// 仪表盘管理类
class DashboardManager {
    constructor() {
        this.stats = {
            totalProjects: 0,
            totalTestCases: 0,
            todaySuccessRate: 0,
            todayFailureRate: 0,
            historicalSuccessRate: 0,
            historicalFailureRate: 0,
            todayNewCases: 0
        };
        this.activities = [];
        this.trendData = [];
        this.productDistribution = [];
        // 最近活动分页状态（默认每页5条）
        this.activityPage = 1;
        this.activityPageSize = 5;
    }

    // 初始化仪表盘
    async init() {
        try {
            await this.loadDashboardData();
            this.renderDashboard();
            this.startAutoRefresh();
        } catch (error) {
            console.error('仪表盘初始化失败:', error);
            this.showError('仪表盘加载失败，请刷新页面重试');
        }
    }

    // 加载仪表盘数据
    async loadDashboardData() {
        try {
            // 并行获取各种数据
            const [statsData, activitiesData, trendsData] = await Promise.all([
                this.fetchStats(),
                this.fetchRecentActivities(),
                this.fetchTrendData()
            ]);

            this.stats = statsData;
            this.activities = activitiesData;
            this.trendData = trendsData;
        } catch (error) {
            console.error('加载仪表盘数据失败:', error);
            throw error;
        }
    }

    // 分页获取所有自动化项目
    async fetchAllAutomationProjects() {
        const projects = [];
        try {
            let page = 1;
            let totalPages = 1;
            const maxPageSize = 100; // 后端限制
            do {
                const resp = await fetch(`/api/automation/projects?page=${page}&page_size=${maxPageSize}`);
                const data = await resp.json();
                if (data && data.success) {
                    const list = (data.data && (data.data.projects || data.data)) || [];
                    if (Array.isArray(list)) projects.push(...list);
                    const pagination = data.data && data.data.pagination;
                    if (pagination) {
                        totalPages = pagination.total_pages || pagination.totalPages || pagination.pages || 1;
                    } else {
                        totalPages = page; // 无分页信息则认为只有一页
                    }
                } else {
                    break;
                }
                page += 1;
            } while (page <= totalPages);
        } catch (e) {
            console.warn('fetchAllAutomationProjects 失败:', e);
        }
        console.log('fetchAllAutomationProjects 完成，数量: ', projects.length);
        return projects;
    }

    // 获取统计数据
    async fetchStats() {
        try {
            // 获取产品数量（从projects表）
            let totalProjects = 0;
            try {
                const projectsResponse = await fetch('/api/version/projects');
                const projectsData = await projectsResponse.json();
                totalProjects = projectsData.success ? projectsData.data.length : 0;
                // 预留给饼图：保存产品列表供名称映射
                this._allProductsCache = projectsData && projectsData.success ? (projectsData.data || []) : [];
            } catch (e) {
                console.warn('获取产品数据失败:', e);
            }

            // 获取自动化项目数量（测试案例）与用于计算今日新增的完整列表
            let totalTestCases = 0;
            let projectsFullList = [];
            let automationData = { data: [] };
            try {
                // 先请求第一页以获取total_count
                const firstResp = await fetch('/api/automation/projects?page=1&page_size=1');
                automationData = await firstResp.json();
                if (automationData && automationData.success && automationData.data && automationData.data.pagination) {
                    totalTestCases = automationData.data.pagination.total_count || 0;
                }
                // 获取完整列表用于"今日新增案例" 和 产品分布
                projectsFullList = await this.fetchAllAutomationProjects();
                if (!totalTestCases && Array.isArray(projectsFullList)) {
                    totalTestCases = projectsFullList.length;
                }
                // 计算产品分布（用于饼图）
                this.productDistribution = this.calculatePackageDistribution(projectsFullList);
            } catch (e) {
                console.warn('获取自动化项目数据失败:', e);
            }

            // 获取执行历史数据来计算成功率
            let rates = {
                todaySuccess: 0,
                todayFailure: 0,
                historicalSuccess: 0,
                historicalFailure: 0
            };
            try {
                const executionData = await this.fetchExecutionHistory();
                console.log('用于计算成功率的执行数据: ', {
                    count: executionData.length,
                    sample: executionData.slice(0, 5).map(x => ({
                        status: x.status,
                        end_time: this.getExecutionEndTime(x),
                        end_ts: this.toTimestampMs(this.getExecutionEndTime(x))
                    }))
                });
                rates = this.calculateSuccessRates(executionData);
            } catch (e) {
                console.warn('获取执行历史数据失败:', e);
            }
            
            const result = {
                totalProjects,
                totalTestCases,
                todaySuccessRate: rates.todaySuccess,
                todayFailureRate: rates.todayFailure,
                historicalSuccessRate: rates.historicalSuccess,
                historicalFailureRate: rates.historicalFailure,
                todayNewCases: this.calculateTodayNewCases(projectsFullList)
            };
            
            console.log('仪表盘统计数据:', result);
            console.log('automationData第一页结构:', automationData);
            console.log('fetchAllAutomationProjects 数量:', Array.isArray(projectsFullList) ? projectsFullList.length : 'N/A', {
                sample: (projectsFullList || []).slice(0, 5).map(p => ({
                    id: p.id || p.project_id,
                    created: p.created_at || p.create_time || p.createdAt,
                    created_ts: this.toTimestampMs(p.created_at || p.create_time || p.createdAt)
                }))
            });
            return result;
        } catch (error) {
            console.error('获取统计数据失败:', error);
            // 返回真实的基础数据，成功率为0（因为没有执行记录）
            return {
                totalProjects: 0,
                totalTestCases: 0,
                todaySuccessRate: 0,
                todayFailureRate: 0,
                historicalSuccessRate: 0,
                historicalFailureRate: 0,
                todayNewCases: 0
            };
        }
    }

    // 获取执行历史数据
    async fetchExecutionHistory() {
        try {
            // 优先尝试分页拉取全量数据，避免仅取前100条导致统计失真
            const executions = [];
            let page = 1;
            const pageSize = 1000;
            let totalPages = 1;

            while (page <= totalPages) {
                const resp = await fetch(`/api/automation/executions?page=${page}&page_size=${pageSize}`);
                const data = await resp.json();
                const pageExecutions = data && data.success
                    ? (data.data && (data.data.executions || data.data.items || data.data.data) || [])
                    : [];
                // 累加
                executions.push(...pageExecutions);

                // 读取分页信息（尽量兼容多种字段）
                const pagination = data && data.data && data.data.pagination;
                if (pagination) {
                    totalPages = pagination.total_pages || pagination.totalPages || pagination.pages || 1;
                } else {
                    // 如果没有分页信息且本页数量小于pageSize，认为已结束
                    totalPages = pageExecutions.length < pageSize ? page : page + 1;
                }
                page += 1;
            }
            console.log('fetchExecutionHistory 拉取完成: ', {
                executionCount: executions.length,
                sample: executions.slice(0, 5).map(x => ({
                    status: x.status,
                    end_time: this.getExecutionEndTime(x),
                    end_ts: this.toTimestampMs(this.getExecutionEndTime(x))
                }))
            });
            return executions;
        } catch (error) {
            console.error('获取执行历史失败:', error);
            try {
                // 退化为一次性大页拉取
                const response = await fetch('/api/automation/executions?page_size=10000');
                const data = await response.json();
                return data.success ? (data.data.executions || []) : [];
            } catch (e) {
                return [];
            }
        }
    }

    // 将执行状态归一化为 passed/failed/other
    normalizeExecutionStatus(status) {
        if (!status) return 'other';
        const s = String(status).toLowerCase();
        if (s.includes('pass') || s === '成功' || s === '通过') return 'passed';
        if (s.includes('fail') || s === '失败') return 'failed';
        return 'other';
    }

    // 提取执行的结束时间（优先end_time）
    getExecutionEndTime(execution) {
        return execution.end_time || execution.finish_time || execution.completed_at || execution.updated_at || execution.start_time || execution.created_at;
    }

    // 提取执行的开始时间（优先start_time）
    getExecutionStartTime(execution) {
        return execution.start_time || execution.begin_time || execution.started_at || execution.created_at;
    }

    // 统一将各种时间（字符串/秒时间戳/毫秒时间戳/Date）转换为毫秒时间戳
    toTimestampMs(value) {
        if (!value) return NaN;
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
        const parsed = Date.parse(value);
        return isNaN(parsed) ? NaN : parsed;
    }

    // 将时间值格式化为 yyyy/MM/dd HH:mm:ss
    formatDateTimeYMDHMS(value) {
        const ms = this.toTimestampMs(value);
        if (isNaN(ms)) return '';
        const d = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
    }

    // 判断一个时间字符串是否明确为UTC（包含 Z 或 GMT 或 +00:00）
    isUtcLikeString(value) {
        if (!value || typeof value !== 'string') return false;
        const s = value.toUpperCase();
        return s.includes('Z') || s.includes('GMT') || s.includes('+00:00') || s.endsWith(' UTC');
    }

    // 判断执行数据是否应按UTC进行日界计算（多数记录带有UTC标记即认为是UTC）
    shouldUseUtcForExecutions(executions) {
        if (!Array.isArray(executions) || executions.length === 0) return false;
        let checked = 0;
        let utcTagged = 0;
        for (let i = 0; i < executions.length && checked < 20; i++) {
            const endTime = this.getExecutionEndTime(executions[i]);
            if (!endTime) continue;
            checked++;
            if (this.isUtcLikeString(String(endTime))) utcTagged++;
        }
        return checked > 0 && (utcTagged / checked) >= 0.5;
    }

    // 判断测试案例创建时间是否应按UTC进行日界计算
    shouldUseUtcForCreated(items) {
        if (!Array.isArray(items) || items.length === 0) return false;
        let checked = 0;
        let utcTagged = 0;
        for (let i = 0; i < items.length && checked < 20; i++) {
            const created = items[i] && (items[i].created_at || items[i].create_time || items[i].createdAt);
            if (!created) continue;
            checked++;
            if (this.isUtcLikeString(String(created))) utcTagged++;
        }
        return checked > 0 && (utcTagged / checked) >= 0.5;
    }

    // 计算给定日期的起止毫秒（按本地或UTC）
    getStartEndOfDay(dateObj, useUtc) {
        const d = new Date(dateObj.getTime());
        if (useUtc) {
            // 将时间对齐到UTC日界
            d.setUTCHours(0, 0, 0, 0);
            const start = d.getTime();
            d.setUTCHours(23, 59, 59, 999);
            const end = d.getTime();
            return { start, end };
        }
        // 本地日界
        d.setHours(0, 0, 0, 0);
        const start = d.getTime();
        d.setHours(23, 59, 59, 999);
        const end = d.getTime();
        return { start, end };
    }

    // 计算成功率（今日/历史）
    calculateSuccessRates(executionData) {
        const now = new Date();
        const useUtc = this.shouldUseUtcForExecutions(executionData);
        const { start: startOfToday, end: endOfToday } = this.getStartEndOfDay(now, useUtc);

        // 今日（按 end_time 所在日期，使用本地日界）
        const todayExecutions = executionData.filter(item => {
            const endTime = this.getExecutionEndTime(item);
            if (!endTime) return false;
            const ts = this.toTimestampMs(endTime);
            return ts >= startOfToday && ts <= endOfToday;
        });
        const todayPassed = todayExecutions.filter(item => this.normalizeExecutionStatus(item.status) === 'passed').length;
        const todayTotal = todayExecutions.length;
        const todaySuccessRate = todayTotal > 0 ? Math.round((todayPassed / todayTotal) * 100) : 0;
        const todayFailureRate = todayTotal > 0 ? 100 - todaySuccessRate : 0;

        // 截至当天的历史（全部记录）
        const allTotal = executionData.length;
        const allPassed = executionData.filter(item => this.normalizeExecutionStatus(item.status) === 'passed').length;
        const historicalSuccessRate = allTotal > 0 ? Math.round((allPassed / allTotal) * 100) : 0;
        const historicalFailureRate = allTotal > 0 ? 100 - historicalSuccessRate : 0;

        console.log('calculateSuccessRates 输入与计算: ', {
            allTotal,
            allPassed,
            startOfToday,
            endOfToday,
            useUtc,
            todayExecutionsCount: todayExecutions.length,
            todayPassed,
            todayTotal,
            todaySuccessRate,
            historicalSuccessRate
        });

        return {
            todaySuccess: todaySuccessRate,
            todayFailure: todayFailureRate,
            historicalSuccess: historicalSuccessRate,
            historicalFailure: historicalFailureRate
        };
    }

    // 计算今日新增测试案例
    calculateTodayNewCases(testCases) {
        // 如果接口提供直接过滤，优先使用
        // 备用：从已获取的数组中按 created_at 过滤
        try {
            // 防御：如果不是数组，返回0
            if (!Array.isArray(testCases)) return 0;
            const today = new Date();
            const useUtc = this.shouldUseUtcForCreated(testCases);
            const { start: startOfDay, end: endOfDay } = this.getStartEndOfDay(today, useUtc);

            const count = testCases.filter(testCase => {
                const created = testCase.created_at || testCase.create_time || testCase.createdAt;
                if (!created) return false;
                const ts = this.toTimestampMs(created);
                return ts >= startOfDay && ts <= endOfDay;
            }).length;
            console.log('calculateTodayNewCases 统计: ', { total: testCases.length, todayCount: count, startOfDay, endOfDay, useUtc });
            return count;
        } catch (e) {
            console.warn('calculateTodayNewCases 计算失败，返回0:', e);
            return 0;
        }
    }

    // 获取最近活动
    async fetchRecentActivities() {
        try {
            const executionData = await this.fetchExecutionHistory();
            return executionData
                // 不限制为10条，交由分页控制展示数量
                .map(item => {
                    const normalized = this.normalizeExecutionStatus(item.status);
                    const executor = item.executed_by || item.operator || item.executor || item.user || '系统';
                    const startTime = this.getExecutionStartTime(item);
                    const timeText = startTime ? `开始: ${this.formatDateTimeYMDHMS(startTime)}` : '';
                    return {
                        type: normalized === 'passed' ? 'success' : 'error',
                        text: `${item.process_name || '测试项目'} ${normalized === 'passed' ? '通过' : '失败'}`,
                        time: timeText,
                        icon: normalized === 'passed' ? 'fas fa-check-circle' : 'fas fa-exclamation-circle',
                        executor: executor
                    };
                });
        } catch (error) {
            console.error('获取最近活动失败:', error);
            return [];
        }
    }

    // 获取趋势数据（近7天，按 end_time 分日统计）
    async fetchTrendData() {
        try {
            const executionData = await this.fetchExecutionHistory();
            const useUtc = this.shouldUseUtcForExecutions(executionData);
            const last7Days = [];
            
            for (let i = 6; i >= 0; i--) {
                const base = new Date();
                if (useUtc) {
                    // 以UTC进行按天分组
                    base.setUTCHours(0, 0, 0, 0);
                    base.setUTCDate(base.getUTCDate() - i);
                    const y = base.getUTCFullYear();
                    const m = base.getUTCMonth();
                    const d = base.getUTCDate();
                    const start = Date.UTC(y, m, d, 0, 0, 0, 0);
                    const end = Date.UTC(y, m, d, 23, 59, 59, 999);
                    const dayExecutions = executionData.filter(item => {
                        const endTime = this.getExecutionEndTime(item);
                        if (!endTime) return false;
                        const ts = this.toTimestampMs(endTime);
                        return ts >= start && ts <= end;
                    });
                    const success = dayExecutions.filter(item => this.normalizeExecutionStatus(item.status) === 'passed').length;
                    const total = dayExecutions.length;
                    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
                    last7Days.push({
                        date: (m + 1) + '/' + d,
                        successRate,
                        total
                    });
                } else {
                    // 本地分组
                    base.setHours(0, 0, 0, 0);
                    base.setDate(base.getDate() - i);
                    const y = base.getFullYear();
                    const m = base.getMonth();
                    const d = base.getDate();
                    const start = new Date(y, m, d, 0, 0, 0, 0).getTime();
                    const end = new Date(y, m, d, 23, 59, 59, 999).getTime();
                    const dayExecutions = executionData.filter(item => {
                        const endTime = this.getExecutionEndTime(item);
                        if (!endTime) return false;
                        const ts = this.toTimestampMs(endTime);
                        return ts >= start && ts <= end;
                    });
                    const success = dayExecutions.filter(item => this.normalizeExecutionStatus(item.status) === 'passed').length;
                    const total = dayExecutions.length;
                    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
                    last7Days.push({
                        date: (m + 1) + '/' + d,
                        successRate,
                        total
                    });
                }
            }
            
            console.log('fetchTrendData 7日成功率: ', last7Days, 'useUtc:', useUtc);
            return last7Days;
        } catch (error) {
            console.error('获取趋势数据失败:', error);
            return [];
        }
    }

    // 渲染仪表盘
    renderDashboard() {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = this.getDashboardHTML();
        
        // 渲染图表
        setTimeout(() => {
            this.renderTrendChart();
            this.renderProductPieChart();
            this.animateCounters();
            this.renderActivities();
        }, 100);
    }

    // 获取仪表盘HTML
    getDashboardHTML() {
        return `
            <div class="dashboard-container">
                <!-- 统计卡片 -->
                <div class="stats-grid">
                    <div class="stat-card primary">
                        <div class="stat-header">
                            <div class="stat-info">
                                <h3>产品总数</h3>
                                <div class="stat-value" data-target="${this.stats.totalProjects}">0</div>
                                <div class="stat-change positive">
                                    <i class="fas fa-arrow-up"></i>
                                    <span>较昨日</span>
                                </div>
                            </div>
                            <div class="stat-icon">
                                <i class="fas fa-cube"></i>
                            </div>
                        </div>
                    </div>

                    <div class="stat-card success">
                        <div class="stat-header">
                            <div class="stat-info">
                                <h3>测试案例总数</h3>
                                <div class="stat-value" data-target="${this.stats.totalTestCases}">0</div>
                                <div class="stat-change positive">
                                    <i class="fas fa-arrow-up"></i>
                                    <span>持续增长</span>
                                </div>
                            </div>
                            <div class="stat-icon">
                                <i class="fas fa-list-check"></i>
                            </div>
                        </div>
                    </div>

                    <div class="stat-card info">
                        <div class="stat-header">
                            <div class="stat-info">
                                <h3>今日成功率</h3>
                                <div class="stat-value" data-target="${this.stats.todaySuccessRate}">0</div>
                                <div class="stat-change ${this.stats.todaySuccessRate >= 80 ? 'positive' : 'negative'}">
                                    <i class="fas fa-${this.stats.todaySuccessRate >= 80 ? 'arrow-up' : 'arrow-down'}"></i>
                                    <span>${this.stats.todaySuccessRate}%</span>
                                </div>
                            </div>
                            <div class="stat-icon">
                                <i class="fas fa-chart-line"></i>
                            </div>
                        </div>
                    </div>

                    <div class="stat-card warning">
                        <div class="stat-header">
                            <div class="stat-info">
                                <h3>历史成功率</h3>
                                <div class="stat-value" data-target="${this.stats.historicalSuccessRate}">0</div>
                                <div class="stat-change ${this.stats.historicalSuccessRate >= 85 ? 'positive' : 'neutral'}">
                                    <i class="fas fa-chart-bar"></i>
                                    <span>总体趋势</span>
                                </div>
                            </div>
                            <div class="stat-icon">
                                <i class="fas fa-history"></i>
                            </div>
                        </div>
                    </div>

                    <div class="stat-card danger">
                        <div class="stat-header">
                            <div class="stat-info">
                                <h3>今日新增案例</h3>
                                <div class="stat-value" data-target="${this.stats.todayNewCases}">0</div>
                                <div class="stat-change positive">
                                    <i class="fas fa-plus"></i>
                                    <span>新增</span>
                                </div>
                            </div>
                            <div class="stat-icon">
                                <i class="fas fa-plus-circle"></i>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 图表区域 -->
                <div class="charts-grid">
                    <div class="chart-card">
                        <div class="chart-header">
                            <div class="chart-title">
                                <i class="fas fa-chart-area"></i>
                                7天成功率趋势
                            </div>
                        </div>
                        <div class="chart-content">
                            <svg id="trendChart" class="trend-chart" viewBox="0 0 600 300">
                                <defs>
                                    <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.8" />
                                        <stop offset="100%" style="stop-color:#667eea;stop-opacity:0.1" />
                                    </linearGradient>
                                </defs>
                            </svg>
                        </div>
                    </div>

                    <div class="chart-card">
                        <div class="chart-header">
                            <div class="chart-title">
                                								<i class="fas fa-chart-pie"></i>
								测试案例数量分布（按产品包名）
                            </div>
                        </div>
                        <div class="chart-content">
                            <svg id="productPieChart" class="pie-chart" viewBox="0 0 300 300"></svg>
                            <div id="productPieLegend" class="pie-legend"></div>
                        </div>
                    </div>

                </div>

                <!-- 活动和快速操作 -->
                <div class="activity-section">
                    <div class="activity-card">
                        <div class="activity-header">
                            <i class="fas fa-clock"></i>
                            <span class="activity-title">最近活动</span>
                        </div>
                        <div class="activity-list">
                            ${this.getActivitiesHTML()}
                        </div>
                        <div id="activity-pagination">
                            ${this.getActivitiesPaginationHTML()}
                        </div>
                    </div>

                    <div class="activity-card">
                        <div class="activity-header">
                            <i class="fas fa-rocket"></i>
                            <span class="activity-title">快速操作</span>
                        </div>
                        <div class="quick-actions">
                            <button class="quick-action-btn" onclick="loadProductManagement()">
                                <i class="fas fa-plus"></i>
                                <span>添加产品</span>
                            </button>
                            <button class="quick-action-btn" onclick="loadAutomationManagement()">
                                <i class="fas fa-robot"></i>
                                <span>创建测试</span>
                            </button>
                            <button class="quick-action-btn" onclick="dashboardManager.refreshData()">
                                <i class="fas fa-sync-alt"></i>
                                <span>刷新数据</span>
                            </button>
                            <button class="quick-action-btn" onclick="dashboardManager.exportReport()">
                                <i class="fas fa-download"></i>
                                <span>导出报告</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // 获取活动列表HTML（分页）
    getActivitiesHTML() {
        if (this.activities.length === 0) {
            return `
                <div class="activity-item">
                    <div class="activity-icon info">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-text">暂无最近活动</div>
                        <div class="activity-time">开始使用平台后将显示活动记录</div>
                    </div>
                </div>
            `;
        }

        const startIndex = (this.activityPage - 1) * this.activityPageSize;
        const endIndex = Math.min(startIndex + this.activityPageSize, this.activities.length);
        const pageItems = this.activities.slice(startIndex, endIndex);

        return pageItems.map(activity => `
            <div class="activity-item">
                <div class="activity-icon ${activity.type}">
                    <i class="${activity.icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        <span class="executor-badge" title="执行人">${activity.executor ? activity.executor : '系统'}</span>
                        ${activity.text}
                    </div>
                    <div class="activity-time">${activity.time}</div>
                </div>
            </div>
        `).join('');
    }

    // 获取活动分页控件HTML（复用执行记录分页样式）
    getActivitiesPaginationHTML() {
        const total = this.activities.length;
        if (total === 0) return '';
        const totalPages = Math.max(1, Math.ceil(total / this.activityPageSize));
        const page = Math.min(this.activityPage, totalPages);
        const startItem = (page - 1) * this.activityPageSize + 1;
        const endItem = Math.min(page * this.activityPageSize, total);

        // 简化的页码显示（最多显示5个页码）
        const pages = [];
        const maxToShow = 5;
        let start = Math.max(1, page - Math.floor(maxToShow / 2));
        let end = Math.min(totalPages, start + maxToShow - 1);
        if (end - start + 1 < maxToShow) start = Math.max(1, end - maxToShow + 1);
        for (let p = start; p <= end; p++) pages.push(p);

        return `
            <div class="execution-pagination activity-pagination">
                <div class="pagination-info">
                    <span>显示第 ${startItem}-${endItem} 条，共 ${total} 条记录</span>
                </div>
                <div class="pagination-controls">
                    <div class="pagination-size-selector">
                        <label>每页显示：</label>
                        <select id="activityPageSizeSelect" class="form-control" onchange="dashboardManager.changeActivityPageSize(this.value)">
                            <option value="5" ${this.activityPageSize === 5 ? 'selected' : ''}>5</option>
                            <option value="10" ${this.activityPageSize === 10 ? 'selected' : ''}>10</option>
                            <option value="20" ${this.activityPageSize === 20 ? 'selected' : ''}>20</option>
                        </select>
                    </div>
                    <div class="pagination-buttons">
                        <button class="btn" onclick="dashboardManager.setActivityPage(1)" ${page === 1 ? 'disabled' : ''}>
                            <i class="fas fa-angle-double-left"></i>
                        </button>
                        <button class="btn" onclick="dashboardManager.setActivityPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>
                            <i class="fas fa-angle-left"></i>
                        </button>
                        <div class="page-numbers">
                            ${start > 1 ? '<span class="page-ellipsis">...</span>' : ''}
                            ${pages.map(p => `
                                <button class="btn page-number ${p === page ? 'btn-primary' : ''}" onclick="dashboardManager.setActivityPage(${p})">${p}</button>
                            `).join('')}
                            ${end < totalPages ? '<span class="page-ellipsis">...</span>' : ''}
                        </div>
                        <button class="btn" onclick="dashboardManager.setActivityPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>
                            <i class="fas fa-angle-right"></i>
                        </button>
                        <button class="btn" onclick="dashboardManager.setActivityPage(${totalPages})" ${page === totalPages ? 'disabled' : ''}>
                            <i class="fas fa-angle-double-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // 仅更新“最近活动”区域
    renderActivities() {
        const listEl = document.querySelector('.activity-list');
        if (listEl) listEl.innerHTML = this.getActivitiesHTML();
        const paginationEl = document.getElementById('activity-pagination');
        if (paginationEl) paginationEl.innerHTML = this.getActivitiesPaginationHTML();
    }

    // 切换页码
    setActivityPage(page) {
        const totalPages = Math.max(1, Math.ceil(this.activities.length / this.activityPageSize));
        const nextPage = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
        if (nextPage === this.activityPage) return;
        this.activityPage = nextPage;
        this.renderActivities();
    }

    // 修改每页条数
    changeActivityPageSize(size) {
        const newSize = Math.max(1, parseInt(size, 10) || 5);
        if (newSize === this.activityPageSize) return;
        this.activityPageSize = newSize;
        this.activityPage = 1;
        this.renderActivities();
    }


    // 渲染趋势图
    renderTrendChart() {
        const svg = document.getElementById('trendChart');
        if (!svg) return;

        const width = 600;
        const height = 300;
        const padding = 40;
        
        // 清除现有内容（保留defs）
        while (svg.children.length > 1) {
            svg.removeChild(svg.lastChild);
        }

        // 无数据时，画空坐标轴并退出
        if (!this.trendData || this.trendData.length === 0) {
            // 画x轴
            const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            axis.setAttribute('x1', padding);
            axis.setAttribute('y1', height - padding);
            axis.setAttribute('x2', width - padding);
            axis.setAttribute('y2', height - padding);
            axis.setAttribute('stroke', '#e2e8f0');
            axis.setAttribute('stroke-width', '1');
            svg.appendChild(axis);
            return;
        }

        // 计算坐标
        const maxRateRaw = Math.max(...this.trendData.map(d => d.successRate), 0);
        // 保证y轴至少到100，且避免除0
        const maxRate = Math.max(100, maxRateRaw);

        // 如果只有一个点，复制一个点以画线，同时保证点绘制
        const dataForLine = this.trendData.length === 1
            ? [this.trendData[0], this.trendData[0]]
            : this.trendData;

        const points = dataForLine.map((d, i) => {
            const x = padding + (i * (width - 2 * padding)) / (dataForLine.length - 1);
            const y = height - padding - ((d.successRate / maxRate) * (height - 2 * padding));
            return { x, y, rate: d.successRate, date: d.date };
        });

        console.log('renderTrendChart 数据点: ', { trendData: this.trendData, points });

        // 悬停提示（百分比）
        const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltip.setAttribute('font-size', '12');
        tooltip.setAttribute('fill', '#2d3748');
        tooltip.setAttribute('text-anchor', 'middle');
        tooltip.style.display = 'none';
        svg.appendChild(tooltip);

        // 基础坐标轴
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', padding);
        xAxis.setAttribute('y1', height - padding);
        xAxis.setAttribute('x2', width - padding);
        xAxis.setAttribute('y2', height - padding);
        xAxis.setAttribute('stroke', '#e2e8f0');
        xAxis.setAttribute('stroke-width', '1');
        svg.appendChild(xAxis);

        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', padding);
        yAxis.setAttribute('y1', height - padding);
        yAxis.setAttribute('x2', padding);
        yAxis.setAttribute('y2', padding);
        yAxis.setAttribute('stroke', '#e2e8f0');
        yAxis.setAttribute('stroke-width', '1');
        svg.appendChild(yAxis);

        // y轴刻度（0、50、100）
        [0, 50, 100].forEach(val => {
            const y = height - padding - ((val / maxRate) * (height - 2 * padding));
            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', padding - 5);
            tick.setAttribute('y1', y);
            tick.setAttribute('x2', padding);
            tick.setAttribute('y2', y);
            tick.setAttribute('stroke', '#cbd5e0');
            tick.setAttribute('stroke-width', '1');
            svg.appendChild(tick);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', padding - 10);
            label.setAttribute('y', y + 4);
            label.setAttribute('text-anchor', 'end');
            label.setAttribute('font-size', '12');
            label.setAttribute('fill', '#718096');
            label.textContent = val + '%';
            svg.appendChild(label);
        });

        // 创建路径
        const pathData = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');

        // 创建填充区域路径
        const areaData = `M${points[0].x},${height - padding} L` + points.map(p => `${p.x},${p.y}`).join(' L') + ` L${points[points.length - 1].x},${height - padding} Z`;

        // 添加填充区域
        const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        area.setAttribute('d', areaData);
        area.setAttribute('class', 'trend-area');
        svg.appendChild(area);

        // 添加线条
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', pathData);
        line.setAttribute('class', 'trend-line');
        svg.appendChild(line);

        // 添加数据点（使用原始trendData来标注x）
        const baseLen = this.trendData.length;
        this.trendData.forEach((d, i) => {
            const x = padding + (i * (width - 2 * padding)) / (baseLen - 1 || 1);
            const y = height - padding - ((d.successRate / maxRate) * (height - 2 * padding));
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', x);
            dot.setAttribute('cy', y);
            dot.setAttribute('r', '4');
            dot.setAttribute('class', 'trend-point');
            dot.setAttribute('title', `${d.date}: ${d.successRate}%`);
            dot.addEventListener('mouseenter', () => {
                dot.setAttribute('r', '6');
                tooltip.textContent = `${d.successRate}%`;
                tooltip.setAttribute('x', x);
                tooltip.setAttribute('y', y - 10);
                // template = null; // 防止某些环境下优化合并
                tooltip.style.display = '';
            });
            dot.addEventListener('mouseleave', () => {
                dot.setAttribute('r', '4');
                tooltip.style.display = 'none';
            });
            svg.appendChild(dot);
        });

        // 添加x轴标签
        this.trendData.forEach((d, i) => {
            const x = padding + (i * (width - 2 * padding)) / (this.trendData.length - 1 || 1);
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', height - 10);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '12');
            text.setAttribute('fill', '#718096');
            text.textContent = d.date;
            svg.appendChild(text);
        });
    }

    // 数字动画
    animateCounters() {
        const counters = document.querySelectorAll('.stat-value[data-target]');
        
        counters.forEach(counter => {
            const target = parseInt(counter.getAttribute('data-target'));
            const duration = 800;
            const step = target / (duration / 16);
            let current = 0;

            const timer = setInterval(() => {
                current += step;
                if (current >= target) {
                    current = target;
                    clearInterval(timer);
                }
                counter.textContent = Math.floor(current);
            }, 16);
        });
    }

    // 格式化时间
    formatTime(timestamp) {
        const now = new Date();
        const time = new Date(timestamp);
        const diff = now - time;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return Math.floor(diff / 86400000) + '天前';
    }

    // 刷新数据
    async refreshData() {
        try {
            showToast('正在刷新数据...', 'info');
            await this.loadDashboardData();
            this.renderDashboard();
            showToast('数据刷新成功', 'success');
        } catch (error) {
            console.error('刷新数据失败:', error);
            showToast('数据刷新失败', 'error');
        }
    }

    // 构建HTML报告
    buildHtmlReport() {
        const stats = this.stats || {};
        const trends = Array.isArray(this.trendData) ? this.trendData : [];
        const activities = Array.isArray(this.activities) ? this.activities : [];
        const generatedAt = new Date().toLocaleString('zh-CN');

        const safe = (v) => typeof v === 'string' ? (typeof escapeHtml === 'function' ? escapeHtml(v) : v) : (v ?? '');
        const formatPercent = (n) => (Number.isFinite(n) ? n : 0) + '%';

        const totalExecutions = trends.reduce((sum, d) => sum + (d.total || 0), 0);
        const weightedSuccess = totalExecutions > 0
            ? Math.round(trends.reduce((acc, d) => acc + (d.successRate || 0) * (d.total || 0), 0) / totalExecutions)
            : 0;

        const trendRowsHtml = trends.length
            ? trends.map(d => `
                    <tr>
                        <td>${safe(d.date || '')}</td>
                        <td>${formatPercent(d.successRate || 0)}</td>
                        <td>${d.total || 0}</td>
                    </tr>
                `).join('')
            : '<tr><td colspan="3" style="text-align:center;color:#718096;">暂无趋势数据</td></tr>';

        const activityItemsHtml = activities.length
            ? activities.slice(0, 50).map(a => `
                    <li>
                        <span class="dot ${a.type === 'success' ? 'ok' : 'err'}"></span>
                        <span class="text">${safe(a.text || '')}</span>
                        <span class="time">${safe(a.time || '')}</span>
                    </li>
                `).join('')
            : '<li style="text-align:center;color:#718096;">暂无最近活动</li>';

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>测试报告</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; background:#f7fafc; color:#1a202c; margin:0; padding:24px; }
    .container { max-width: 960px; margin: 0 auto; background:#ffffff; border-radius:12px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); overflow:hidden; }
    .header { background: linear-gradient(135deg, #667eea, #764ba2); color:white; padding:24px; }
    .header h1 { margin:0 0 8px 0; font-size:22px; }
    .header .meta { opacity:.9; font-size:14px; }
    .section { padding:20px 24px; border-top:1px solid #edf2f7; }
    .section h2 { margin:0 0 12px 0; font-size:18px; color:#2d3748; }
    table { width:100%; border-collapse: collapse; background:white; }
    th, td { padding:10px 12px; border-bottom:1px solid #edf2f7; text-align:left; }
    th { background:#f7fafc; color:#4a5568; font-weight:600; }
    .stats-grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px; }
    .stat { background:#f7fafc; border:1px solid #edf2f7; border-radius:10px; padding:12px; }
    .stat .label { color:#4a5568; font-size:12px; }
    .stat .value { font-size:20px; font-weight:700; margin-top:4px; color:#2d3748; }
    ul.activities { list-style:none; padding:0; margin:0; }
    ul.activities li { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #edf2f7; }
    ul.activities li .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
    ul.activities li .dot.ok { background:#48bb78; }
    ul.activities li .dot.err { background:#f56565; }
    ul.activities li .text { flex:1; }
    ul.activities li .time { color:#718096; font-size:12px; }
    .footer { padding:16px 24px; color:#718096; font-size:12px; text-align:right; }
    @media print { body { background:white; padding:0; } .container { box-shadow:none; border-radius:0; } .section { page-break-inside: avoid; } }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>测试报告</h1>
        <div class="meta">生成时间：${generatedAt}</div>
    </div>
    <div class="section">
        <h2>概览统计</h2>
        <div class="stats-grid">
            <div class="stat"><div class="label">产品总数</div><div class="value">${stats.totalProjects || 0}</div></div>
            <div class="stat"><div class="label">测试案例总数</div><div class="value">${stats.totalTestCases || 0}</div></div>
            <div class="stat"><div class="label">今日成功率</div><div class="value">${formatPercent(stats.todaySuccessRate || 0)}</div></div>
            <div class="stat"><div class="label">历史成功率</div><div class="value">${formatPercent(stats.historicalSuccessRate || 0)}</div></div>
            <div class="stat"><div class="label">今日新增用例</div><div class="value">${stats.todayNewCases || 0}</div></div>
        </div>
    </div>
    <div class="section">
        <h2>近7日趋势</h2>
        <div style="margin-bottom:8px;color:#4a5568;">加权成功率：${formatPercent(weightedSuccess)}（总执行数：${totalExecutions}）</div>
        <table>
            <thead><tr><th>日期</th><th>成功率</th><th>执行数</th></tr></thead>
            <tbody>
                ${trendRowsHtml}
            </tbody>
        </table>
    </div>
    <div class="section">
        <h2>最近活动</h2>
        <ul class="activities">
            ${activityItemsHtml}
        </ul>
    </div>
    <div class="footer">由系统自动生成 · 如需详细原始数据，请在系统中导出JSON</div>
</div>
</body>
</html>`;
    }

    // 导出报告
    async exportReport() {
        try {
            const html = this.buildHtmlReport();
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `dashboard-report-${new Date().toISOString().split('T')[0]}.html`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('报告导出成功', 'success');
        } catch (error) {
            console.error('导出报告失败:', error);
            showToast('导出报告失败', 'error');
        }
    }

    // 显示错误信息
    showError(message) {
        const contentArea = document.getElementById('content-area');
        contentArea.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; color: white; text-align: center;">
                <i class="fas fa-exclamation-triangle" style="font-size: 4rem; margin-bottom: 1rem; color: #f56565;"></i>
                <h3 style="margin-bottom: 1rem;">${message}</h3>
                <button onclick="dashboardManager.init()" style="padding: 0.75rem 1.5rem; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    <i class="fas fa-redo"></i> 重新加载
                </button>
            </div>
        `;
    }

    // 自动刷新
    startAutoRefresh() {
        // 每5分钟自动刷新一次数据
        setInterval(() => {
            this.loadDashboardData().then(() => {
                // 只更新数据，不重新渲染整个页面
                this.updateDashboardData();
            }).catch(error => {
                console.error('自动刷新失败:', error);
            });
        }, 5 * 60 * 1000);
    }

    // 更新仪表盘数据（不重新渲染）
    updateDashboardData() {
        console.log('更新仪表盘数据:', this.stats);
        // 更新统计数字
        const counters = document.querySelectorAll('.stat-value[data-target]');
        console.log('找到的统计元素:', counters.length);
        counters.forEach((counter, index) => {
            const statKeys = ['totalProjects', 'totalTestCases', 'todaySuccessRate', 'historicalSuccessRate', 'todayNewCases'];
            if (statKeys[index]) {
                const newTarget = this.stats[statKeys[index]];
                console.log(`更新 ${statKeys[index]}: ${newTarget}`);
                counter.setAttribute('data-target', newTarget);
                counter.textContent = newTarget;
            }
        });

        // 更新图表
        this.renderTrendChart();
        this.renderProductPieChart();
        // 更新最近活动（数据更新后刷新当前分页）
        this.renderActivities();
    }

    // 解析 automation_projects 的 product_package_names 字段
    parsePackageNames(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
        const s = String(value).trim();
        if (!s) return [];
        try {
            const arr = JSON.parse(s);
            if (Array.isArray(arr)) return arr.map(v => String(v)).filter(Boolean);
        } catch (_) {}
        return s.split(/[;,，、\s]+/).map(v => v.trim()).filter(Boolean);
    }

    // 按产品包名计算分布
    calculatePackageDistribution(projects) {
        const counter = new Map();
        let unspecified = 0;
        (projects || []).forEach(ap => {
            const names = this.parsePackageNames(ap.product_package_names);
            if (!names.length) {
                unspecified += 1;
                return;
            }
            names.forEach(name => {
                const key = name || '未指定';
                counter.set(key, (counter.get(key) || 0) + 1);
            });
        });
        const result = Array.from(counter.entries()).map(([name, count]) => ({
            name,
            count
        })).sort((a, b) => b.count - a.count);
        if (unspecified > 0) result.push({ name: '未指定', count: unspecified });
        console.log('产品包名分布统计: ', result);
        return result;
    }

    // 渲染产品分布饼图（现代风格 + 悬停动画 + 提示）
    renderProductPieChart() {
        const svg = document.getElementById('productPieChart');
        const legend = document.getElementById('productPieLegend');
        if (!svg) return;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        if (legend) legend.innerHTML = '';

        this.ensurePieStyles();

        const data = this.productDistribution || [];
        const total = data.reduce((sum, d) => sum + d.count, 0);
        const width = 360, height = 360, cx = 180, cy = 180, rOuter = 126, rInner = 78;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('shape-rendering', 'geometricPrecision');

        if (!total) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', cx);
            text.setAttribute('y', cy);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', '#94a3b8');
            text.setAttribute('font-size', '14');
            text.setAttribute('font-family', "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif");
            text.textContent = '暂无数据';
            svg.appendChild(text);
            return;
        }

        const palette = ['#6366f1','#8b5cf6','#22c55e','#0ea5e9','#f59e0b','#ef4444','#14b8a6','#f472b6','#a855f7','#06b6d4'];

        // defs: 阴影、发光与渐变
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const drop = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        drop.setAttribute('id', 'pieShadow');
        drop.innerHTML = '<feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#000" flood-opacity="0.28"/>';
        defs.appendChild(drop);
        const innerShadow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        innerShadow.setAttribute('id', 'innerShadow');
        innerShadow.setAttribute('x', '-50%');
        innerShadow.setAttribute('y', '-50%');
        innerShadow.setAttribute('width', '200%');
        innerShadow.setAttribute('height', '200%');
        innerShadow.innerHTML = `
            <feOffset dx="0" dy="1"/>
            <feGaussianBlur stdDeviation="2.2" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="out" result="inverse"/>
            <feFlood flood-color="#0f172a" flood-opacity="0.35" result="color"/>
            <feComposite in="color" in2="inverse" operator="in" result="shadow"/>
            <feComposite in="shadow" in2="SourceGraphic" operator="over"/>
        `;
        defs.appendChild(innerShadow);
        const ringGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        ringGrad.setAttribute('id', 'ringGrad');
        ringGrad.setAttribute('x1', '0%'); ringGrad.setAttribute('y1', '0%'); ringGrad.setAttribute('x2', '100%'); ringGrad.setAttribute('y2', '0%');
        let stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', '0%'); stop.setAttribute('stop-color', '#94a3b8'); stop.setAttribute('stop-opacity', '0.25'); ringGrad.appendChild(stop);
        stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', '100%'); stop.setAttribute('stop-color', '#e2e8f0'); stop.setAttribute('stop-opacity', '0.35'); ringGrad.appendChild(stop);
        defs.appendChild(ringGrad);
        const innerGlow = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
        innerGlow.setAttribute('id', 'innerGlow');
        innerGlow.setAttribute('cx', '50%'); innerGlow.setAttribute('cy', '50%'); innerGlow.setAttribute('r', '60%');
        let s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop'); s1.setAttribute('offset', '40%'); s1.setAttribute('stop-color', '#0ea5e9'); s1.setAttribute('stop-opacity', '0.08'); innerGlow.appendChild(s1);
        let s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#0ea5e9'); s2.setAttribute('stop-opacity', '0'); innerGlow.appendChild(s2);
        defs.appendChild(innerGlow);
        svg.appendChild(defs);

        // 背景装饰：旋转外环与淡淡的同心圆
        const deco = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(deco);
        const outerRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        outerRing.setAttribute('cx', cx); outerRing.setAttribute('cy', cy); outerRing.setAttribute('r', String(rOuter + 8));
        outerRing.setAttribute('fill', 'none');
        outerRing.setAttribute('stroke', 'url(#ringGrad)');
        outerRing.setAttribute('stroke-width', '6');
        outerRing.setAttribute('opacity', '0.45');
        outerRing.innerHTML = '<animateTransform attributeName="transform" type="rotate" from="0 '+cx+' '+cy+'" to="360 '+cx+' '+cy+'" dur="30s" repeatCount="indefinite"/>';
        deco.appendChild(outerRing);
        const faint1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        faint1.setAttribute('cx', cx); faint1.setAttribute('cy', cy); faint1.setAttribute('r', String((rOuter + rInner) / 2));
        faint1.setAttribute('fill', 'none');
        faint1.setAttribute('stroke', '#94a3b8');
        faint1.setAttribute('stroke-opacity', '0.12');
        faint1.setAttribute('stroke-dasharray', '2 6');
        deco.appendChild(faint1);

        // 主组
        const gRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gRoot.style.transition = 'transform 520ms cubic-bezier(0.22,1,0.36,1), opacity 460ms ease';
        gRoot.style.transformOrigin = `${cx}px ${cy}px`;
        gRoot.style.opacity = '0';
        gRoot.style.transform = 'scale(0.92)';
        svg.appendChild(gRoot);

        let angle = -Math.PI / 2; // 从正上方开始
        data.forEach((item, idx) => {
            const portion = item.count / total;
            const endAngle = angle + portion * Math.PI * 2;
            const x1 = cx + rOuter * Math.cos(angle);
            const y1 = cy + rOuter * Math.sin(angle);
            const x2 = cx + rOuter * Math.cos(endAngle);
            const y2 = cy + rOuter * Math.sin(endAngle);
            const xi2 = cx + rInner * Math.cos(endAngle);
            const yi2 = cy + rInner * Math.sin(endAngle);
            const xi1 = cx + rInner * Math.cos(angle);
            const yi1 = cy + rInner * Math.sin(angle);
            const largeArc = portion > 0.5 ? 1 : 0;
            const pathData = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${rInner} ${rInner} 0 ${largeArc} 0 ${xi1} ${yi1} Z`;

            // 渐变
            const gradId = `pieGrad${idx}`;
            const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
            grad.setAttribute('id', gradId);
            grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%'); grad.setAttribute('x2', '0%'); grad.setAttribute('y2', '100%');
            const c = palette[idx % palette.length];
            const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', c); stop1.setAttribute('stop-opacity', '0.98');
            const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', c); stop2.setAttribute('stop-opacity', '0.72');
            grad.appendChild(stop1); grad.appendChild(stop2); defs.appendChild(grad);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.classList.add('pie-slice');
            g.style.transition = 'transform 230ms cubic-bezier(0.22,1,0.36,1)';
            g.style.transformOrigin = `${cx}px ${cy}px`;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('fill', `url(#${gradId})`);
            path.setAttribute('cursor', 'pointer');
            path.setAttribute('aria-label', `${item.name} ${item.count}`);
            path.setAttribute('stroke', 'rgba(255,255,255,0.06)');
            path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke-linejoin', 'round');

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${item.name}: ${item.count}`;
            path.appendChild(title);
            g.appendChild(path);
            gRoot.appendChild(g);

            const mid = angle + (endAngle - angle) / 2;
            const offset = 10;

            // 悬停交互与提示
            const ensureTooltip = () => {
                let tip = document.getElementById('productPieTooltip');
                if (!tip) {
                    tip = document.createElement('div');
                    tip.id = 'productPieTooltip';
                    tip.style.position = 'fixed';
                    tip.style.pointerEvents = 'none';
                    tip.style.background = 'rgba(17, 24, 39, 0.92)';
                    tip.style.color = '#e5e7eb';
                    tip.style.padding = '8px 10px';
                    tip.style.borderRadius = '10px';
                    tip.style.fontSize = '12.5px';
                    tip.style.fontFamily = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
                    tip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
                    tip.style.backdropFilter = 'blur(2px)';
                    tip.style.zIndex = '1000';
                    tip.style.opacity = '0';
                    tip.style.transition = 'opacity 140ms ease';
                    document.body.appendChild(tip);
                }
                return tip;
            };

            const showTooltip = (ev) => {
                const tip = ensureTooltip();
                const pct = Math.round((item.count / total) * 100);
                tip.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
                    <span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px;"></span>
                    <span style="color:#f8fafc;font-weight:600;">${item.name}</span>
                    <span style="color:#94a3b8;">${item.count}（${pct}%）</span>
                </div>`;
                tip.style.left = `${ev.clientX + 12}px`;
                tip.style.top = `${ev.clientY + 12}px`;
                tip.style.opacity = '1';
            };

            const hideTooltip = () => {
                const tip = document.getElementById('productPieTooltip');
                if (tip) tip.style.opacity = '0';
            };

            g.addEventListener('mouseenter', (ev) => {
                const dx = Math.cos(mid) * offset;
                const dy = Math.sin(mid) * offset;
                g.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
                path.setAttribute('filter', 'url(#pieShadow)');
                path.setAttribute('stroke', 'rgba(255,255,255,0.25)');
                path.setAttribute('stroke-width', '1.25');
                gRoot.appendChild(g); // 置顶
                showTooltip(ev);
            });
            g.addEventListener('mousemove', (ev) => showTooltip(ev));
            g.addEventListener('mouseleave', () => {
                g.style.transform = 'translate(0px, 0px) scale(1)';
                path.removeAttribute('filter');
                path.setAttribute('stroke', 'rgba(255,255,255,0.06)');
                path.setAttribute('stroke-width', '1');
                hideTooltip();
            });

            angle = endAngle;
        });

        // 内圈高光与内阴影，增强层次
        const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        innerCircle.setAttribute('cx', cx); innerCircle.setAttribute('cy', cy); innerCircle.setAttribute('r', String(rInner - 1));
        innerCircle.setAttribute('fill', 'url(#innerGlow)');
        innerCircle.setAttribute('filter', 'url(#innerShadow)');
        svg.appendChild(innerCircle);

        // 初始入场动画
        requestAnimationFrame(() => {
            gRoot.style.opacity = '1';
            gRoot.style.transform = 'scale(1)';
        });

        // 图例（含百分比）
        if (legend) {
            // 提升整体可读性：高对比文本、去除不透明度影响
            legend.style.opacity = '1';
            legend.style.filter = 'none';
            legend.style.color = '#0f172a';
            legend.style.fontFamily = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
            legend.style.fontSize = '14px';
            legend.style.lineHeight = '1.35';

            legend.innerHTML = data.map((item, idx) => {
                const pct = Math.round((item.count / total) * 100);
                return `
                    <div style="display:flex;align-items:center;margin:10px 0;gap:12px;">
                        <span style="display:inline-block;width:12px;height:12px;background:${palette[idx % palette.length]};border-radius:3px;box-shadow:0 0 0 2px rgba(0,0,0,0.06);"></span>
                        <span style="color:#0f172a;font-weight:700;letter-spacing:.2px;">${item.name}</span>
                        <span style="margin-left:auto;color:#0b1220;font-weight:800;font-variant-numeric:tabular-nums;">${item.count}</span>
                        <span style="color:#64748b;margin-left:8px;font-weight:600;">（${pct}%）</span>
                    </div>
                `;
            }).join('');
        }
    }

    // 注入一次性的样式（字体渲染优化等）
    ensurePieStyles() {
        if (document.getElementById('pieGlobalStyles')) return;
        const style = document.createElement('style');
        style.id = 'pieGlobalStyles';
        style.textContent = `
            svg#productPieChart text { font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; }
        `;
        document.head.appendChild(style);
    }
}

// 全局仪表盘管理器实例
let dashboardManager = null;

// 初始化仪表盘
function initDashboard() {
    dashboardManager = new DashboardManager();
    dashboardManager.init();
}

// 加载仪表盘页面
function loadDashboard() {
    // 更新导航状态
    updateNavigation('dashboard');
    
    // 初始化仪表盘
    initDashboard();
}

// 更新导航状态
function updateNavigation(activePage) {
    // 移除所有活动状态
    document.querySelectorAll('.nav-subitem').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // 设置对应的活动状态
    if (activePage === 'dashboard') {
        document.getElementById('dashboardNav').classList.add('active');
    }
} 