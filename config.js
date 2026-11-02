// 지도 설정 — API 키가 필요한 지도를 쓰려면 아래 값을 채우세요. (README '지도 설정' 참고)
window.APP_CONFIG = {
  // 'osm' (키 불필요, 기본) | 'vworld' (국토교통부 브이월드, 키 필요)
  baseMap: 'osm',
  vworldKey: '',            // https://www.vworld.kr 에서 발급, 서비스 URL(도메인) 등록 필요
  osmTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  initialCenter: [37.55, 127.15],
  initialZoom: 9
};
