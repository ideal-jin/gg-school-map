// 지도 설정
window.APP_CONFIG = {
  // 처음 보여 줄 배경지도: 'simple'(단순 지도, 기본) | 'light'(아주 단순, 흑백) | 'osm'(자세한 지도)
  //                         | 'vworld_white' | 'vworld'  ← 아래 vworldKey를 넣었을 때만
  // 방문자는 지도 오른쪽 위 버튼으로 바꿀 수 있고, 고른 지도는 그 브라우저에 기억됩니다.
  baseMap: 'simple',
  vworldKey: '',            // https://www.vworld.kr 에서 발급, 서비스 URL에 https://ideal-jin.github.io 등록
  osmTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  initialCenter: [37.55, 127.15],
  initialZoom: 9
};
