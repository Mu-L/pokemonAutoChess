import { BOARD_HEIGHT, BOARD_WIDTH } from "../../types/Config"
import { Ability } from "../../types/enum/Ability"
import { EffectEnum } from "../../types/enum/Effect"
import { AttackType, Team } from "../../types/enum/Game"
import { Item } from "../../types/enum/Item"
import { Passive } from "../../types/enum/Passive"
import { Pkm, PkmIndex } from "../../types/enum/Pokemon"
import { Synergy } from "../../types/enum/Synergy"
import { chance } from "../../utils/random"
import { values } from "../../utils/schemas"
import { AbilityStrategies } from "../abilities/abilities"
import { Board, Cell } from "../board"
import { PokemonEntity } from "../pokemon-entity"
import {
  Effect,
  OnAbilityCastEffect,
  OnAttackEffect,
  OnDamageReceivedEffect,
  OnHitEffect,
  OnKillEffect,
  OnMoveEffect,
  OnSpawnEffect
} from "./effect"
import { ItemEffects } from "./items"

export function drumBeat(pokemon: PokemonEntity, board: Board) {
  const speed = pokemon.status.paralysis ? pokemon.speed / 2 : pokemon.speed
  pokemon.resetCooldown(1000, speed) // use attack state cooldown
  if (pokemon.pp >= pokemon.maxPP && !pokemon.status.silence) {
    // CAST ABILITY
    let crit = false
    if (pokemon.effects.has(EffectEnum.ABILITY_CRIT)) {
      crit = chance(pokemon.critChance / 100, pokemon)
    }
    const target = pokemon.state.getNearestTargetAtSight(pokemon, board)?.target
    if (target) {
      AbilityStrategies[pokemon.skill].process(pokemon, board, target, crit)
    }
    return
  }

  pokemon.count.attackCount++
  pokemon.targetY = -1
  const ppGained = 1 + pokemon.stars
  board
    .getAdjacentCells(pokemon.positionX, pokemon.positionY, true)
    .forEach((cell) => {
      if (cell.value && cell.value.team === pokemon.team) {
        cell.value.addPP(ppGained, pokemon, 0, false)
      }
    })
  pokemon.effectsSet.forEach((effect) => {
    if (effect instanceof OnAttackEffect) {
      effect.apply({
        pokemon,
        target: null,
        board,
        physicalDamage: 0,
        specialDamage: 0,
        trueDamage: 0,
        totalDamage: 0
      })
    }
  })
  const itemEffects: OnAttackEffect[] = values(pokemon.items)
    .flatMap((item) => ItemEffects[item] ?? [])
    .filter((effect) => effect instanceof OnAttackEffect)
  itemEffects.forEach((effect) => {
    effect.apply({
      pokemon,
      target: null,
      board,
      physicalDamage: 0,
      specialDamage: 0,
      trueDamage: 0,
      totalDamage: 0
    })
  })
}

export function stenchJump(
  pokemon: PokemonEntity,
  board: Board,
  x: number,
  y: number
) {
  board
    .getCellsBetween(x, y, pokemon.positionX, pokemon.positionY)
    .forEach((cell) => {
      if (cell.x !== x || cell.y !== y) {
        board.addBoardEffect(
          cell.x,
          cell.y,
          EffectEnum.POISON_GAS,
          pokemon.simulation
        )
      }
    })
}

export function partingShot(
  pokemon: PokemonEntity,
  target: PokemonEntity,
  x: number,
  y: number
) {
  target.addAbilityPower(-20, pokemon, 0, false)
  target.addAttack(-0.2 * target.baseAtk, pokemon, 0, false)
  pokemon.broadcastAbility({
    skill: "PARTING_SHOT",
    positionX: x,
    positionY: y
  })
}

const SharedVisionEffect = new OnAttackEffect(({ pokemon, board }) => {
  board.forEach((x: number, y: number, ally: PokemonEntity | undefined) => {
    if (
      ally &&
      ally.passive === Passive.SHARED_VISION &&
      pokemon.team === ally.team &&
      pokemon.targetEntityId !== ally.id // do not self inflict damage if ally is confused and targeting you
    ) {
      ally.targetX = pokemon.targetX
      ally.targetY = pokemon.targetY
      ally.targetEntityId = pokemon.targetEntityId
    }
  })
})

const DurantBugBuffEffect = new OnAttackEffect(({ pokemon, target, board }) => {
  if (target) {
    const bugAllies =
      board.cells.filter(
        (entity) =>
          entity &&
          entity.team === pokemon.team &&
          entity.types.has(Synergy.BUG)
      ).length - 1
    if (bugAllies > 0) {
      target.handleDamage({
        damage: bugAllies,
        board,
        attackType: AttackType.TRUE,
        attacker: pokemon,
        shouldTargetGainMana: true
      })
    }
  }
})

const MiniorKernelOnAttackEffect = new OnAttackEffect(
  ({ pokemon, target, board, physicalDamage }) => {
    if (
      target &&
      (pokemon.name === Pkm.MINIOR_KERNEL_BLUE ||
        pokemon.name === Pkm.MINIOR_KERNEL_GREEN ||
        pokemon.name === Pkm.MINIOR_KERNEL_RED ||
        pokemon.name === Pkm.MINIOR_KERNEL_ORANGE)
    ) {
      const cells = board.getAdjacentCells(target.positionX, target.positionY)
      const targets = cells
        .filter((cell) => cell.value && pokemon.team != cell.value.team)
        .map((cell) => cell.value!)
        .concat(target)
      targets.forEach((t) => {
        pokemon.broadcastAbility({
          skill: Ability.SHIELDS_DOWN,
          targetX: t.positionX,
          targetY: t.positionY
        })
        if (pokemon.name === Pkm.MINIOR_KERNEL_BLUE) {
          t.handleDamage({
            damage: Math.ceil(physicalDamage * (1 + pokemon.ap / 100)),
            board,
            attackType: AttackType.SPECIAL,
            attacker: pokemon,
            shouldTargetGainMana: false
          })
        }
        if (pokemon.name === Pkm.MINIOR_KERNEL_RED) {
          t.handleDamage({
            damage: Math.ceil(physicalDamage * 1.5 * (1 + pokemon.ap / 100)),
            board,
            attackType: AttackType.PHYSICAL,
            attacker: pokemon,
            shouldTargetGainMana: false
          })
        }
        if (pokemon.name === Pkm.MINIOR_KERNEL_ORANGE) {
          t.handleDamage({
            damage: Math.ceil(physicalDamage * 0.5 * (1 + pokemon.ap / 100)),
            board,
            attackType: AttackType.TRUE,
            attacker: pokemon,
            shouldTargetGainMana: false
          })
        }
      })
      if (pokemon.name === Pkm.MINIOR_KERNEL_GREEN) {
        cells.forEach((v) => {
          if (v && v.value && v.value.team === pokemon.team) {
            v.value.handleHeal(physicalDamage, pokemon, 1, false)
          }
        })
      }
    }
  }
)

const KubfuOnKillEffect = new OnKillEffect(
  (pokemon, target, board, attackType) => {
    const SPEED_BUFF_PER_KILL = 3
    const AP_BUFF_PER_KILL = 5
    const MAX_BUFFS = 10
    if (attackType === AttackType.PHYSICAL) {
      const baseSpeed = 50
      const nbBuffs = Math.floor(
        (pokemon.refToBoardPokemon.speed - baseSpeed) / SPEED_BUFF_PER_KILL
      )
      if (nbBuffs < MAX_BUFFS) {
        pokemon.addSpeed(SPEED_BUFF_PER_KILL, pokemon, 0, false, true)
        if (
          nbBuffs + 1 === MAX_BUFFS &&
          pokemon.player &&
          pokemon.player.items.includes(Item.SCROLL_OF_WATERS) === false
        ) {
          pokemon.player.items.push(Item.SCROLL_OF_WATERS)
        }
      }
    } else {
      const nbBuffs = Math.floor(
        pokemon.refToBoardPokemon.ap / AP_BUFF_PER_KILL
      )
      if (nbBuffs < MAX_BUFFS) {
        pokemon.addAbilityPower(AP_BUFF_PER_KILL, pokemon, 0, false, true)
        if (
          nbBuffs + 1 === MAX_BUFFS &&
          pokemon.player &&
          pokemon.player.items.includes(Item.SCROLL_OF_DARKNESS) === false
        ) {
          pokemon.player.items.push(Item.SCROLL_OF_DARKNESS)
        }
      }
    }
  }
)

export const WaterSpringEffect = new OnAbilityCastEffect((pokemon, board) => {
  board.forEach((x, y, pkm) => {
    if (pkm?.passive === Passive.WATER_SPRING && pkm.team !== pokemon.team) {
      pkm.addPP(5, pkm, 0, false)
      pkm.broadcastAbility({ skill: pkm.skill })
    }
  })
})

export const SlowStartEffect = new OnAbilityCastEffect((pokemon, board) => {
  if (pokemon.count.ult === 1) {
    pokemon.addSpeed(30, pokemon, 0, false)
    pokemon.addAttack(10, pokemon, 0, false)
  }
})

export class AccelerationEffect extends OnMoveEffect {
  accelerationStacks = 0

  constructor() {
    super((pkm, board, x, y) => {
      pkm.addSpeed(20, pkm, 0, false)
      this.accelerationStacks += 1
    })
  }
}

const MimikuBustedTransformEffect = new OnDamageReceivedEffect(({ pokemon }) => {
  if (pokemon.life / pokemon.hp < 0.5) {
    pokemon.index = PkmIndex[Pkm.MIMIKYU_BUSTED]
    pokemon.name = Pkm.MIMIKYU_BUSTED
    pokemon.changePassive(Passive.MIMIKYU_BUSTED)
    pokemon.addAttack(10, pokemon, 0, false)
    pokemon.status.triggerProtect(2000)
    if (pokemon.player) {
      pokemon.player.pokemonsPlayed.add(Pkm.MIMIKYU_BUSTED)
    }
  }
})

const DarmanitanZenTransformEffect = new OnDamageReceivedEffect(({ pokemon, board }) => {
  if (pokemon.life < 0.3 * pokemon.hp && pokemon.passive === Passive.DARMANITAN) {
    pokemon.index = PkmIndex[Pkm.DARMANITAN_ZEN]
    pokemon.name = Pkm.DARMANITAN_ZEN
    pokemon.changePassive(Passive.DARMANITAN_ZEN)
    pokemon.skill = Ability.TRANSE
    pokemon.pp = 0
    const destination = board.getTeleportationCell(
      pokemon.positionX,
      pokemon.positionY,
      pokemon.team
    )
    if (destination) pokemon.moveTo(destination.x, destination.y, board)
    pokemon.toIdleState()
    pokemon.addAttack(-10, pokemon, 0, false)
    pokemon.addSpeed(-20, pokemon, 0, false)
    pokemon.addDefense(10, pokemon, 0, false)
    pokemon.addSpecialDefense(10, pokemon, 0, false)
    pokemon.range += 4
    pokemon.attackType = AttackType.SPECIAL
  }
})

const DarmanitanZenOnHitEffect = new OnHitEffect(({ attacker, totalTakenDamage }) => {
  attacker.handleHeal(totalTakenDamage, attacker, 0, false)
})

const PikachuSurferBuffEffect = new OnSpawnEffect((pkm) => {
  if (!pkm.player) return
  const aquaticStepReached = pkm.player.synergies.getSynergyStep(Synergy.AQUATIC)
  pkm.addShield(50 * aquaticStepReached, pkm, 0, false)
  pkm.addAttack(3 * aquaticStepReached, pkm, 0, false)
})

const ToxicSpikesEffect = new OnDamageReceivedEffect(({ pokemon, board }) => {
  if (pokemon.passive === Passive.GLIMMORA && pokemon.life < 0.5 * pokemon.hp) {
    pokemon.changePassive(Passive.NONE)

    const cells = new Array<Cell>()

    let startY = 1
    let endY = 3
    if (pokemon.team === Team.RED_TEAM) {
      startY = -2
      endY = 0
    }

    for (let x = -1; x < 2; x++) {
      for (let y = startY; y < endY; y++) {
        if (
          !(
            pokemon.positionX + x < 0 ||
            pokemon.positionX + x > BOARD_WIDTH ||
            pokemon.positionY + y < 0 ||
            pokemon.positionY + y > BOARD_HEIGHT
          )
        ) {
          cells.push({
            x: pokemon.positionX + x,
            y: pokemon.positionY + y,
            value:
              board.cells[
              board.columns * pokemon.positionY + y + pokemon.positionX + x
              ]
          })
        }
      }
    }

    cells.forEach((cell) => {
      board.addBoardEffect(
        cell.x,
        cell.y,
        EffectEnum.TOXIC_SPIKES,
        pokemon.simulation
      )

      pokemon.broadcastAbility({
        skill: "TOXIC_SPIKES",
        targetX: cell.x,
        targetY: cell.y
      })

      if (cell.value && cell.value.team !== pokemon.team) {
        cell.value.handleSpecialDamage(
          20,
          board,
          AttackType.SPECIAL,
          pokemon,
          false
        )
      }
    })
  }
})

export const PassiveEffects: Partial<Record<Passive, (Effect | (() => Effect))[]>> = {
  [Passive.DURANT]: [DurantBugBuffEffect],
  [Passive.SHARED_VISION]: [SharedVisionEffect],
  [Passive.METEOR]: [MiniorKernelOnAttackEffect],
  [Passive.KUBFU]: [KubfuOnKillEffect],
  [Passive.SLOW_START]: [SlowStartEffect],
  [Passive.VIGOROTH]: [
    new OnSpawnEffect((pkm) => pkm.effects.add(EffectEnum.IMMUNITY_SLEEP))
  ],
  [Passive.PIKACHU_SURFER]: [PikachuSurferBuffEffect],
  [Passive.ACCELERATION]: [
    () => new AccelerationEffect() // needs new instance of effect for each pokemon due to internal stack counter
  ],
  [Passive.MIMIKYU]: [MimikuBustedTransformEffect],
  [Passive.DARMANITAN]: [DarmanitanZenTransformEffect],
  [Passive.DARMANITAN_ZEN]: [DarmanitanZenOnHitEffect],
  [Passive.GLIMMORA]: [ToxicSpikesEffect]
}
