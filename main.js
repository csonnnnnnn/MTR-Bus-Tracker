// 計算文字長度的函數（中文按 2 單位，英文按 1 單位）
function calculateTextLength(text) {
    let length = 0;
    for (let char of text) {
        if (/[\u4e00-\u9fff]/.test(char)) {
            length += 2; // 中文字符計為 2 單位
        } else {
            length += 1; // 英文字符、符號等計為 1 單位
        }
    }
    return length;
}

// 切換顯示車型表格的函數
function showModel(model) {
    const tables = document.querySelectorAll('.model-table');
    tables.forEach(table => {
        table.style.display = 'none';
    });
    const selectedTable = document.getElementById(`table-${model.replace(/\s/g, '_')}`);
    if (selectedTable) {
        selectedTable.style.display = 'table';
    }
}

// 初始化地圖，中心設為香港
const map = L.map('map').setView([22.4123, 114.0855], 11);
// Custom tile layer that adds the required header for local files
const HeaderTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
        const tile = document.createElement('img');
        const url = this.getTileUrl(coords);

        fetch(url, {
            headers: {
                'X-Requested-With': 'MTR-Bus-Tracker-Local'   // any identifiable name is fine
            }
        })
            .then(res => {
                if (!res.ok) throw new Error(res.status);
                return res.blob();
            })
            .then(blob => {
                tile.src = URL.createObjectURL(blob);
                done(null, tile);
            })
            .catch(err => {
                console.error('Tile error', err);
                done(err, tile);
            });

        return tile;
    }
});

// Use it instead of the normal L.tileLayer
const baseLayer = new HeaderTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// 追蹤巴士標記的字典 (key: busId, value: marker)
let busMarkers = {};

// 追蹤 busId 到 lineRef 的映射
let busRoutes = {};

// 定義所有路線列表
const allRoutes = ['K51', 'K51A', 'K52', 'K52A', 'K52P', 'K53', 'K53S', 'K54', 'K54A', 'K58', 'K65', 'K65A', 'K66', 'K66A', 'K68', 'K73', 'K74', 'K75A', 'K75P', 'K75S', 'K76', 'K76S', 'K12', 'K14', 'K17', 'K18', '506'];


// 特別巴士線（只寫 lineRef，不是展示的路線號碼）
const specialLineRefs = new Set([
    '506_GG_TMS',
    'K51_SHS_FT',
    'K51_FT_SHS',
    'K52_LRTMS_LKT',
    'K53S_YWE_CIR',
    'K66_TT_YPH',
    'K66_NHP_LP',
    'K66A_TT_LP',
    'K66A_LP_TT',
    'K66_TT_OHR',
    'K68_YLIE_TKT',
    'K68_YLP_YLIE',
    'K68_TKT_YLIE',
    'K68_SFG_YLIE',
    'K73_TY_YLW',
    'K73_HKFYG_YLW',
    'K75P_HSKBD_TS',
    'K75S_HSKBD_TSWS'
]);

// DOM 元素
const lastUpdateDiv = document.getElementById('lastUpdate');
const busIdInput = document.getElementById('busIdInput');
const searchButton = document.getElementById('searchButton');

// API 呼叫函數，獲取單一路線數據
async function fetchRouteData(routeName) {
    const url = 'https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule';
    const payload = {
        language: 'zh',
        routeName: routeName
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP 錯誤 (${routeName}): ${response.status}`);
        }

        const data = await response.json();
        const routeStatusTime = data.routeStatusTime || (data.busStop && data.busStop.length > 0 ? data.busStop[0].routeStatusTime : new Date().toISOString());
        return { data, routeStatusTime };
    } catch (error) {
        console.error(`API 呼叫錯誤 (${routeName}):`, error);
        return { data: { busStop: [] }, routeStatusTime: new Date().toISOString() };
    }
}

// 高亮巴士表格行
function highlightBus(busId) {
    // 移除之前的高亮
    document.querySelectorAll('.highlight').forEach(row => {
        row.classList.remove('highlight');
    });

    // 查找 busId 對應的車型
    const model = busModelMap[busId];
    if (!model) {
        return;
    }

    // 顯示對應車型的表格
    showModel(model);

    // 高亮對應行
    const table = document.getElementById(`table-${model.replace(/\s/g, '_')}`);
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const busIdCell = row.cells[0];
        if (busIdCell.textContent === busId) {
            row.classList.add('highlight');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                row.classList.remove('highlight');
            }, 2500);
        }
    });
}

// 搜尋巴士並高亮表格行
function searchBus() {
    const busId = busIdInput.value.trim();
    if (!busId) {
        alert('請輸入編號！');
        busIdInput.value = ''; // 清空輸入框
        return;
    }

    highlightBus(busId);

    // 地圖定位
    const marker = busMarkers[busId];
    if (marker) {
        map.setView(marker.getLatLng(), 16);
        marker.openPopup();
    } else {
        alert(`未找到${busId}的地圖位置！`);
    }

    // 清空輸入框
    busIdInput.value = '';
}

// 更新表格中的路線和方向
function updateTableRoutes() {
    for (const busId in busRoutes) {
        const routeCell = document.getElementById(`route-${busId}`);
        const directionCell = document.getElementById(`direction-${busId}`);
        const lastUpdatedCell = document.getElementById(`last-updated-${busId}`);

        if (routeCell && directionCell) {
            const lineRef = busRoutes[busId];
            const routeInfo = routeMap[lineRef];

            if (routeInfo) {
                routeCell.textContent = routeInfo.route;
                directionCell.textContent = routeInfo.direction;
            } else {
                routeCell.textContent = lineRef;
                directionCell.textContent = '';
            }

            if (lastUpdatedCell) {
                const now = new Date();
                lastUpdatedCell.textContent = now.toLocaleTimeString('zh-HK', {
                    timeZone: 'Asia/Hong_Kong',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            }

            // 取得這個 busId 所在的那一行 <tr>
            const row = routeCell.closest('tr');
            if (row) {
                // 如果是特別線就加上 class
                if (specialLineRefs.has(lineRef)) {
                    row.classList.add('special-line');
                } else {
                    row.classList.remove('special-line');
                }
            }
        }
    }
}

// 獲取所有路線的數據並更新地圖
async function fetchAllBusData() {
    try {
        // 清除所有自訂標記，保留底圖
        map.eachLayer(layer => {
            if (layer !== baseLayer) {
                map.removeLayer(layer);
            }
        });
        busMarkers = {};
        busRoutes = {};

        // 並行獲取所有路線數據
        const routePromises = allRoutes.map(route => fetchRouteData(route));
        const allData = await Promise.all(routePromises);

        // 處理每個路線的數據並記錄最新時間
        let latestTime = new Date(0);
        allData.forEach(({ data, routeStatusTime }, index) => {
            const routeName = allRoutes[index];
            if (data.busStop && data.busStop.length > 0) {
                data.busStop.forEach(stop => {
                    if (stop.bus && stop.bus.length > 0) {
                        stop.bus.forEach(bus => {
                            if (bus.busLocation && bus.busId && bus.lineRef) {
                                const { latitude, longitude } = bus.busLocation;
                                if (latitude && longitude) {
                                    const routeInfo = routeMap[bus.lineRef];
                                    const line1Text = routeInfo ? `${bus.busId}@${routeInfo.route}` : `${bus.busId}@${bus.lineRef}`;
                                    const line2Text = routeInfo ? `${routeInfo.direction}` : '';
                                    const labelText = `<div class="line1">${line1Text}</div><div class="line2">${line2Text}</div>`;
                                    // 計算文字長度（取第一行和第二行的最大長度）
                                    const line1Length = calculateTextLength(line1Text);
                                    const line2Length = calculateTextLength(line2Text);
                                    const textLength = Math.max(line1Length, line2Length);
                                    // 根據文字長度動態設置寬度（每單位約 6 像素）
                                    const iconWidth = Math.min(Math.max(textLength * 6, 80), 200); // 寬度範圍 80-200px
                                    const iconHeight = 34; // 兩行文字高度（12px * 2 + 間距和邊距）
                                    // 判斷是否特別線
                                    const isSpecial = specialLineRefs.has(bus.lineRef);

                                    // 加上不同 className
                                    const busIdLabel = L.divIcon({
                                        className: isSpecial ? 'bus-label bus-label-special' : 'bus-label',
                                        html: labelText,
                                        iconSize: [iconWidth, iconHeight],
                                        iconAnchor: [iconWidth / 2, iconHeight / 2]
                                    });

                                    const marker = L.marker([latitude, longitude], { icon: busIdLabel }).addTo(map);
                                    // 為標記添加點擊事件
                                    marker.on('click', () => {
                                        map.setView(marker.getLatLng(), 16);
                                        highlightBus(bus.busId);
                                    });
                                    busMarkers[bus.busId] = marker;

                                    // 更新路線映射
                                    busRoutes[bus.busId] = bus.lineRef;
                                }
                            }
                        });
                    }
                });
            }
            // 更新最新時間
            const time = new Date(routeStatusTime);
            if (time > latestTime) latestTime = time;
        });


        // 更新表格路線和方向
        updateTableRoutes();

        // 更新頁面上的最後更新時間
        const formattedTime = latestTime.toLocaleString('zh-HK', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\//g, '-');
        lastUpdateDiv.textContent = `最後更新：${formattedTime} (HKT)`;


    } catch (error) {
        console.error('總數據處理錯誤:', error);
    }
}

// 初始呼叫
fetchAllBusData();

// 每 10 秒更新一次
setInterval(fetchAllBusData, 10000);

// 綁定搜尋按鈕事件
searchButton.addEventListener('click', searchBus);
// 綁定 Enter 鍵觸發搜尋
busIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchBus();
});