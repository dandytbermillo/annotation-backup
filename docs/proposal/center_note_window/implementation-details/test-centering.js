#!/usr/bin/env node

// Test script to validate centering calculation
// Simulates the coordinate conversion logic

function testCenteringCalculation() {
  console.log('Testing Centering Calculation\n');
  
  // Test Case 1: Panel at world position (2000, 1500)
  // Canvas state: translateX = -1000, translateY = -1200, zoom = 1
  const canvasState = {
    translateX: -1000,
    translateY: -1200,
    zoom: 1
  };
  
  const panelWorldPos = { x: 2000, y: 1500 };
  
  // Calculate where panel appears on screen
  // screenPos = (worldPos + translate) * zoom
  const screenX = (panelWorldPos.x + canvasState.translateX) * canvasState.zoom;
  const screenY = (panelWorldPos.y + canvasState.translateY) * canvasState.zoom;
  
  console.log('Test Case 1: Default position');
  console.log(`Panel world position: (${panelWorldPos.x}, ${panelWorldPos.y})`);
  console.log(`Canvas translate: (${canvasState.translateX}, ${canvasState.translateY})`);
  console.log(`Canvas zoom: ${canvasState.zoom}`);
  console.log(`Panel screen position: (${screenX}, ${screenY})`);
  
  // Now reverse the calculation (as in our DOM lookup)
  // worldPos = screenPos / zoom - translate
  const calculatedWorldX = (screenX / canvasState.zoom) - canvasState.translateX;
  const calculatedWorldY = (screenY / canvasState.zoom) - canvasState.translateY;
  
  console.log(`Calculated world position: (${calculatedWorldX}, ${calculatedWorldY})`);
  console.log(`Match: ${calculatedWorldX === panelWorldPos.x && calculatedWorldY === panelWorldPos.y ? '✅' : '❌'}\n`);
  
  // Test Case 2: With zoom
  const canvasState2 = {
    translateX: -1000,
    translateY: -1200,
    zoom: 1.5
  };
  
  const screenX2 = (panelWorldPos.x + canvasState2.translateX) * canvasState2.zoom;
  const screenY2 = (panelWorldPos.y + canvasState2.translateY) * canvasState2.zoom;
  
  console.log('Test Case 2: With zoom 1.5');
  console.log(`Panel screen position with zoom: (${screenX2}, ${screenY2})`);
  
  const calculatedWorldX2 = (screenX2 / canvasState2.zoom) - canvasState2.translateX;
  const calculatedWorldY2 = (screenY2 / canvasState2.zoom) - canvasState2.translateY;
  
  console.log(`Calculated world position: (${calculatedWorldX2}, ${calculatedWorldY2})`);
  console.log(`Match: ${calculatedWorldX2 === panelWorldPos.x && calculatedWorldY2 === panelWorldPos.y ? '✅' : '❌'}\n`);
  
  // Test what viewport translate should be to center a panel
  const viewportWidth = 1920;
  const viewportHeight = 1080;
  const panelWidth = 800;
  const panelHeight = 600;
  
  // To center panel at (2000, 1500), we need:
  // Panel center should be at viewport center
  // Viewport center = (viewportWidth/2, viewportHeight/2) = (960, 540)
  // Panel center in world = (2000 + 400, 1500 + 300) = (2400, 1800)
  
  // We want: (panelCenterWorld + translate) * zoom = viewportCenter
  // Therefore: translate = (viewportCenter / zoom) - panelCenterWorld
  
  const panelCenterX = panelWorldPos.x + panelWidth / 2;
  const panelCenterY = panelWorldPos.y + panelHeight / 2;
  const viewportCenterX = viewportWidth / 2;
  const viewportCenterY = viewportHeight / 2;
  
  const targetTranslateX = (viewportCenterX / canvasState.zoom) - panelCenterX;
  const targetTranslateY = (viewportCenterY / canvasState.zoom) - panelCenterY;
  
  console.log('Test Case 3: Calculate centering translate');
  console.log(`Panel center world: (${panelCenterX}, ${panelCenterY})`);
  console.log(`Viewport center: (${viewportCenterX}, ${viewportCenterY})`);
  console.log(`Target translate to center: (${targetTranslateX}, ${targetTranslateY})`);
  
  // Verify: does this translate actually center the panel?
  const verifyScreenX = (panelCenterX + targetTranslateX) * canvasState.zoom;
  const verifyScreenY = (panelCenterY + targetTranslateY) * canvasState.zoom;
  console.log(`Verification - panel center on screen: (${verifyScreenX}, ${verifyScreenY})`);
  console.log(`Centered correctly: ${Math.abs(verifyScreenX - viewportCenterX) < 0.01 && Math.abs(verifyScreenY - viewportCenterY) < 0.01 ? '✅' : '❌'}`);
}

testCenteringCalculation();