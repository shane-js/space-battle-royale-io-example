

// 3rd
import 'pixi.js';
const pixiLoader = PIXI.loader;
import 'pixi-layers';
import TileUtilities from './tileUtilities.js';
let tu = new TileUtilities(PIXI);
import _ from 'lodash'
// 1st
const util = require('../common/util');
const { mxp } = util;
const sprites = require('./sprites');

//for debugging
const showCollisionBodyMarkers = false;
let pixiRenderer = null;



// Initialize the renderer by passing in the actual map dimensions,
// which is different from the viewport dimensions.
exports.init = async function ({ x: mapX, y: mapY }, tilesize, collisionWallBodies, tiles, onStageClick) {
    console.assert(Array.isArray(tiles))

    // we assign this soon, but i need to be able to access it
    // in window.onresize.
    pixiRenderer = null;
    let textures = {};


    // STATE
     const state = {
       sprites: Object.create(null)
     };


    // VIEWPORT
      const viewport = {
        x: null,
        y: null,
        // Converts p2 y to pixi y
        fixY (y) {
          return mxp(mapY) - y
        },
        reset () {
          this.x = document.documentElement.clientWidth
          this.y = document.documentElement.clientHeight
        }
      };

      viewport.reset(); // Init viewport

      window.onresize = function () {
        viewport.reset();
        pixiRenderer.resize(viewport.x, viewport.y);
      };


      // STAGE
    let app = new PIXI.Application(viewport.x, viewport.height);
    app.stage = new PIXI.display.Stage();
    let world = null;
    let tiledLayersToLoopThrough = [];
    let backdrop = null;
    pixiRenderer = PIXI.autoDetectRenderer(viewport.x, viewport.y, { transparent: true });
    document.body.appendChild(pixiRenderer.view);

    app.stage.interactive = true
    app.stage.on('mousedown', (e) => {
    const position = e.data.getLocalPosition(app.stage)
    onStageClick(position)
  })

  //add assets to be loaded by pixi
  let deferredPromises = [];
  const pixiLoadPromise = new Promise(function(resolve, reject){
      deferredPromises.push({resolve: resolve, reject: reject});
  });

  let mapFileName = "map1.json";
  let mapFilePath = "./map1.json";
  let mapLayerNames = ["Background", "TileLayer2"];
  let tileSetFileName = "tileset1.png";
  let tileSetFilePath = "./img/tileset1.png";

  pixiLoader
      .add(mapFileName, mapFilePath)
      .add(tileSetFileName, tileSetFilePath)
      .add('bebas_neue_bitmap_0.png', './bebas_neue_bitmap_0.png')
      .add('bebas_neue_bitmap.fnt', './bebas_neue_bitmap.fnt')
      .add("astronaut", "./img/astronaut.png")
      .add("astronautOutline", './img/astronautOutline.png')

  pixiLoader.load((loader, resources) => {
      const x = resources;
      console.log("assets loaded");
      let tileset1_pixiTexture = resources[tileSetFileName].texture;
      world = tu.makeTiledWorld(mapFileName, tileset1_pixiTexture);
      console.log("map world created");
      textures.astronaut = resources.astronaut.texture;
      textures.astronautOutline = resources.astronautOutline.texture;
      deferredPromises[0].resolve(true)
  });

   return await pixiLoadPromise.then(() => {
       app.stage.addChild(world);
       tiledLayersToLoopThrough = mapLayerNames.map(layerName => {return world.getChildByName(layerName)});
       window.world = world;

       //lighting test
       let lighting = new PIXI.display.Layer();
       lighting.on('display', function (element) {
           element.blendMode = PIXI.BLEND_MODES.ADD
       });
       lighting.useRenderTexture = true;
       lighting.clearColor = [0.5, 0.5, 0.5, 1]; // ambient gray
       app.stage.addChild(lighting);

       let lightingSprite = new PIXI.Sprite(lighting.getRenderTexture());
       lightingSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
       app.stage.addChild(lightingSprite);


       const wallWarning = (function () {
           const message = 'Out of bounds'
           const wallWarning =  new PIXI.extras.BitmapText(message, {
               font: '18px BebasNeue',
               fill: 0xFF0000,
               align: 'center'
           })
           wallWarning.anchor.set(0.5)
           wallWarning.visible = false
           world.addChild(wallWarning)
           return wallWarning
       })()


       // TEAM COLORS


       const colors = {
           clearTint: 0xFFFFFF,
           red: 0xFFBBBB,
           blue: 0xA8CFFF,
           orange: 0xEEA73B,
           gray: 0xBEBEBE
       };


       // EXPLOSIONS
       //
       // Active movieclips are maintained in two maps.
       // On every render, we remove any movieclips that
       // are on their last frame.


       // Map of playerId -> PIXI.MovieClip
       const shipExplosions = {}
       // Array of PIXI.MovieClip
       // Using an array here since one bomb my explode two times due to latency,
       // e.g. client simulates local wall hit before it gets server's player-hit
       // broadcast
       const bombExplosions = []



       // 0 is empty, 1 is full
       function getEnergyTint (scale) {
           if (scale < 0.5) {
               // red
               return 0xFF0000
           } else if (scale < 0.75) {
               // yellow
               return 0xF3F315
           } else {
               // green
               return 0x39FF14
           }
       }


       // HELPERS


       // https://gist.github.com/gre/1650294
       const easing = {
           // no easing, no acceleration
           linear: function (t) { return t },
           // accelerating from zero velocity
           easeInQuad: function (t) { return t*t },
           // decelerating to zero velocity
           easeOutQuad: function (t) { return t*(2-t) },
           // acceleration until halfway, then deceleration
           easeInOutQuad: function (t) { return t<.5 ? 2*t*t : -1+(4-2*t)*t },
           // accelerating from zero velocity
           easeInCubic: function (t) { return t*t*t },
           // decelerating to zero velocity
           easeOutCubic: function (t) { return (--t)*t*t+1 },
           // acceleration until halfway, then deceleration
           easeInOutCubic: function (t) { return t<.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1 },
           // accelerating from zero velocity
           easeInQuart: function (t) { return t*t*t*t },
           // decelerating to zero velocity
           easeOutQuart: function (t) { return 1-(--t)*t*t*t },
           // acceleration until halfway, then deceleration
           easeInOutQuart: function (t) { return t<.5 ? 8*t*t*t*t : 1-8*(--t)*t*t*t },
           // accelerating from zero velocity
           easeInQuint: function (t) { return t*t*t*t*t },
           // decelerating to zero velocity
           easeOutQuint: function (t) { return 1+(--t)*t*t*t*t },
           // acceleration until halfway, then deceleration
           easeInOutQuint: function (t) { return t<.5 ? 16*t*t*t*t*t : 1+16*(--t)*t*t*t*t }
       }


       // RENDER

        let lastPlayerX = null, lastPlayerY = null;

       return function render (simulation, currUserId, spritesToRemove, detonatedBombs, killedPlayers) {
           let thisPlayerX = 0, thisPlayerY = 0
           //background stuff first - pixi renders from background to front optimization
           //get new culled tiles
           let thisPlayer = _.find(simulation.players, (player) => player.id === currUserId);
           if(thisPlayer){
               const x = mxp(thisPlayer.body.position.x);
               const y = mxp(thisPlayer.body.position.y);
               const centeredViewPos =  [viewport.x / 2 - x, viewport.y / 2 - viewport.fixY(y)];
               if(world.position.x !== centeredViewPos[0]) world.position.x = centeredViewPos[0];
               if(world.position.y !== centeredViewPos[1]) world.position.y = centeredViewPos[1];
               thisPlayerX = x;
               thisPlayerY = y;
           }
           if(Math.round(thisPlayerX, 0) !== Math.round(lastPlayerX, 0) && Math.round(thisPlayerY, 0) !== Math.round(lastPlayerY, 0)){
               tiledLayersToLoopThrough.forEach(tiledLayerInPixi => {
                   (tiledLayerInPixi.children || []).forEach(tileInPixi => {
                       lastPlayerX = thisPlayerX;
                       lastPlayerY = thisPlayerY;
                       if(util.distanceBetweenTwoPositions({x: thisPlayerX, y: viewport.fixY(thisPlayerY)}, {x: tileInPixi.position._x, y: tileInPixi.position._y}) < 1300){
                           tileInPixi.visible = true;
                       }else{
                           tileInPixi.visible = false;
                       }
                   })
               });
           }

           // Update / decay / destroy existing bob explosions
           for (let i = 0; i < bombExplosions.length; i++) {
               const clip = bombExplosions[i]
               // if clip is at final frame, destroy it
               if (clip.currentFrame === clip.totalFrames - 1) {
                   world.removeChild(clip)
                   clip.destroy()
                   bombExplosions.splice(i, 1)
               }
           }
           if(showCollisionBodyMarkers){
               //debug collisions
               simulation.collisionWallBodies.forEach(wall => {
                   if (state.sprites["wall"+wall.id]) {
                       // sprite exists, so updated it
                       const sprite = state.sprites["wall"+wall.id]
                       const x = mxp(wall.position.x)
                       const y = mxp(wall.position.y)
                       sprite.position.set(x, viewport.fixY(y))
                   } else {
                       // sprite does not exist, so create it
                       // don't interpolate on sprite spawn, causes weird stuff
                       const x = mxp(wall.position.x)
                       const y = mxp(wall.position.y)
                       const sprite = sprites.makeBomb('A', 3)
                       sprite.position.set(x, viewport.fixY(y))
                       state.sprites["wall"+wall.id] = sprite
                       world.addChild(sprite)
                   }
               })
           }

           // Create bomb explosions
           for (const [id, x, y] of detonatedBombs) {
               const clip = sprites.makeBombExplosion()
               clip.position.set(mxp(x), viewport.fixY(mxp(y)))
               bombExplosions.push(clip)
               world.addChild(clip)
           }
           // DECAY / REMOVE SHIP EXPLOSIONS
           for (const id in shipExplosions) {
               const clip = shipExplosions[id]
               // if clip is at final frame, destroy it
               if (clip.currentFrame === clip.totalFrames - 1) {
                   world.removeChild(clip)
                   clip.destroy()
                   delete shipExplosions[id]
               }
           }
           // CREATE SHIP EXPLOSIONS
           // for (const player of killedPlayers) {
           //     const clip = sprites.makeShipExplosion()
           //     clip.position.set(
           //         mxp(player.body.position.x),
           //         viewport.fixY(mxp(player.body.position.y))
           //     )
           //     shipExplosions[player.id] = clip
           //     world.addChild(clip)
           // }

           simulation.deadPlayerMarkers.forEach(deadPlayerMarker => {
               if (!state.sprites["deadPlayerMarker"+deadPlayerMarker.id]) {
                   // sprite does not exist, so create it (no need for update code since these don't move)
                   const x = mxp(deadPlayerMarker.p.x)
                   const y = mxp(deadPlayerMarker.p.y)
                   let sprite = new PIXI.Sprite(textures.astronautOutline);
                   sprite.position.set(x, viewport.fixY(y))
                   sprite.height = 125;
                   sprite.width = 125;
                   sprite.isDeadPlayerMarker = true;
                   sprite.internalId = deadPlayerMarker.id;
                   state.sprites["deadPlayerMarker"+deadPlayerMarker.id] = sprite
                   world.addChild(sprite)
               }
           });

           // Update player sprites
           _.forOwn(simulation.players, (player, id) => {
               if (state.sprites[id]) {
                   // player sprite exists, so update it
                   const x = mxp(player.body.position.x);
                   const y = mxp(player.body.position.y);
                   const container = state.sprites[id];
                   const sprite = container.getChildByName("playerBody");
                   const usernameText = container.getChildByName("playerUsernameText");
                   if(!(container.position._x === x && container.position._y === viewport.fixY(y))) container.position.set(x, viewport.fixY(y));
                   if(sprite.rotation !== player.body.angle) sprite.rotation = player.body.angle;
                   if (!player.isAlive) {
                       if(sprite.alpha !== 0.3) sprite.alpha = 0.3;
                       if(sprite.tint !== colors.gray) sprite.tint = colors.gray;
                       if(usernameText.alpha !== 0.3) usernameText.alpha = 0.3;
                       if(usernameText.tint !== colors.gray) usernameText.tint = colors.gray;

                   } else {
                       if(sprite.alpha !== 1) sprite.alpha = 1;
                       if(sprite.tint !== colors.gray) sprite.tint = colors.clearTint;
                       if(usernameText.alpha !== 1) usernameText.alpha = 1;
                       if(usernameText.tint !== colors.gray) usernameText.tint = colors.clearTint;
                   }
                   // if this player is us, offset stage so that we are centered
                   if (player.id === currUserId) {
                       // also, check if we are out of bounds to display wallWarning
                       if (x < 0 || x > mxp(mapX) || y < 0 || y > mxp(mapY)) {
                           wallWarning.position.x = x
                           wallWarning.position.y = viewport.fixY(y + 50)
                           wallWarning.visible = true
                       } else {
                           wallWarning.visible = false
                       }

                       // update energy bar
                       if (container.energyBar) {
                           const scalar = player.curEnergy / player.maxEnergy
                           container.energyBar.width = sprite.width * scalar
                           container.energyBar.alpha = 1 - easing.easeInCubic(scalar)
                           // update color
                           container.energyBar.tint = getEnergyTint(scalar)
                       }
                   }
               } else {
                   // player sprite must be created
                   const x = mxp(player.body.position.x)
                   const y = mxp(player.body.position.y)
                   const container = new PIXI.Container()
                   // container children (the player sprite and the username)
                   let sprite = new PIXI.Sprite(textures.astronaut);
                   sprite.name = "playerBody";
                   sprite.anchor.set(0.5);
                   sprite.height = 50;
                   sprite.width = 50;
                   sprite.rotation = player.body.angle;
                   const text = new PIXI.extras.BitmapText(player.uname, {
                       font: '18px BebasNeue',
                       fill: 0xFFFFFF,
                       align: 'center'
                   });
                   text.name = "playerUsernameText";
                   text.anchor.set(0.5);
                   text.cacheAsBitmap = true;
                   container.position.set(x, viewport.fixY(y));
                   text.position.set(sprite.x, sprite.y + 35);
                   if (!player.isAlive) {
                       sprite.alpha = 0.3;
                       sprite.tint = colors.gray;
                       text.alpha = 0.3;
                       text.tint = colors.gray;
                   } else {
                       sprite.alpha = 1;
                       sprite.tint = colors.clearTint;
                       text.alpha = 1;
                       text.tint = colors.clearTint;
                   }

                   container.addChild(sprite);
                   container.addChild(text);
                   // Mount energy bar if it's current player
                   if (player.id === currUserId) {
                       const energyBar = makeEnergyBar(sprite.width);
                       energyBar.position.set(sprite.x - sprite.width / 2,
                           sprite.y + sprite.width / 2);
                       container.addChild(energyBar);
                       container.energyBar = energyBar;
                   }

                   // Add to stage
                   state.sprites[id] = container;
                   //app.stage.addChild(container)
                   world.addChild(container);
               }
           })
           // update bomb sprites
           for (const id in simulation.bombs) {
               const bomb = simulation.bombs[id];
               if (state.sprites[id]) {
                   // sprite exists, so update it
                   const sprite = state.sprites[id];
                   const x = mxp(bomb.body.position.x);
                   const y = mxp(bomb.body.position.y);
                   sprite.position.set(x, viewport.fixY(y));
               } else {
                   // sprite does not exist, so create it
                   // don't interpolate on sprite spawn, causes weird stuff
                   const x = mxp(bomb.body.position.x)
                   const y = mxp(bomb.body.position.y)
                   const sprite = sprites.makeBomb('A', 3)
                   sprite.isWeaponProjectile = true;
                   sprite.position.set(x, viewport.fixY(y))
                   state.sprites[id] = sprite
                   world.addChild(sprite)
               }
           }

            //get sprites that need to be removed
           _.forOwn(state.sprites, (currentlyRenderedSprite, key) => {
               let spriteType = null;
               if(currentlyRenderedSprite.isPlayer){
                   spriteType = "player";
               }
               if(currentlyRenderedSprite.isWeaponProjectile){
                   spriteType = "weaponProjectile";
               }
               if(currentlyRenderedSprite.isDeadPlayerMarker){
                   spriteType = "deadPlayerMarker";
               }

               switch(spriteType){
                   case "player":
                       if(!_.findKey(simulation.players, (currentPlayer) => currentPlayer.id == key)){
                           spritesToRemove.push(key);
                       }
                       break;
                   case "weaponProjectile":
                       if(!_.findKey(simulation.bombs, (currentBomb) => currentBomb.id == key)){
                           spritesToRemove.push(key);
                       }
                       break;
                   case "deadPlayerMarker":
                       if((simulation.deadPlayerMarkers || []).filter(marker => marker.id === currentlyRenderedSprite.internalId).length < 1){
                           spritesToRemove.push(key);
                       }
                       break;
               }
           });

           // Clean up old sprites
           for (const id of spritesToRemove) {
               const sprite = state.sprites[id];
               world.removeChild(sprite);
               delete state.sprites[id];
               if (sprite) sprite.destroy();
           }

           spritesToRemove = [];


           //////////GRAPHICS AFTER SPRITES OPTIMIZATION

           // ENERGY BAR
           // energy bar is the rectangle that appears beneath the player's
           // ship to indicate how much energy they have
           function makeEnergyBar (maxWidth) {
               const gfx = new PIXI.Graphics();
               gfx.beginFill(0xFFFFFF);
               gfx.drawRect(0, 0, maxWidth, 5);
               gfx.alpha = 0;
               return gfx;
           }

           //handle light graphic for players
           _.forOwn(simulation.players, (player, id) => {
               let matchingPlayerSprite = state.sprites[id];
               if (matchingPlayerSprite && !matchingPlayerSprite.getChildByName("playerLight")) {
                       let playerLight = new PIXI.Graphics();
                       const rr = Math.random() * 0x80 | 0;
                       const rg = Math.random() * 0x80 | 0;
                       const rb = Math.random() * 0x80 | 0;
                       const rad = 50 + Math.random() * 20;
                       playerLight.beginFill((rr << 16) + (rg << 8) + rb, 1.0);
                       playerLight.drawCircle(0, 0, rad);
                       playerLight.endFill();
                       playerLight.parentLayer = lighting;//<-- try comment it
                       playerLight.visible = player.isAlive;
                       playerLight.name = "playerLight";
                       matchingPlayerSprite.addChild(playerLight);
                   }else if(matchingPlayerSprite && matchingPlayerSprite.getChildByName("playerLight")){
                       //handle turning on and off playerLight
                       const playerLight = matchingPlayerSprite.getChildByName("playerLight");
                       if(playerLight && playerLight.visible !== player.isAlive){
                           playerLight.visible = player.isAlive;
                       }
                   }
           });


           // Render
           pixiRenderer.render(app.stage);
       }
   })

}
