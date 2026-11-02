// 지도 설정
window.APP_CONFIG = {
  // 처음 보여 줄 배경지도: 'vworld_white'(흰색, 기본) | 'vworld_gray'(회색) | 'vworld'(기본 지도) ← vworldKey 필요
  //                         | 'osm'(OpenStreetMap, 키 불필요)
  // 방문자는 지도 오른쪽 위 버튼으로 바꿀 수 있고, 고른 지도는 그 브라우저에 기억됩니다.
  baseMap: 'vworld_white',
  vworldKey: 'ABFB424B-309B-4AAA-A2AC-D7037F5EE869',            // https://www.vworld.kr 에서 발급, 서비스 URL에 https://ideal-jin.github.io 등록
  osmTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  initialCenter: [37.55, 127.15],
  initialZoom: 9
};
