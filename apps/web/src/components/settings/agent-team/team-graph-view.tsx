"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RiAddLine, RiCloseLine, RiPlayLine, RiStarLine, RiStopLine } from "@remixicon/react";
import { AGENT_TEAM_ROLE_SLUG, type AgentTeam, type AgentTeamRole } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRoleVisual } from "./role-metadata";

interface TeamGraphViewProps {
  team: AgentTeam;
  canManage: boolean;
  onRemoveRole: (roleId: string) => Promise<void>;
  onRemoveEdge: (edgeId: string) => Promise<void>;
  onOpenAddRole: () => void;
  onOpenAddEdge: () => void;
}

interface NodePosition {
  x: number;
  y: number;
}

// --- Demo simulation types ---

interface DemoMessage {
  fromSlug: string;
  toSlug: string;
  kind: string;
  text: string;
  color: string;
}

interface DemoTurn {
  activeSlug: string;
  thinkMs: number;
  messages: DemoMessage[];
}

const DEMO_SCRIPT: DemoTurn[] = [
  {
    activeSlug: AGENT_TEAM_ROLE_SLUG.architect,
    thinkMs: 1200,
    messages: [
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.architect,
        toSlug: AGENT_TEAM_ROLE_SLUG.codeReader,
        kind: "question",
        text: "Find the /users endpoint handler",
        color: "#3b82f6",
      },
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.architect,
        toSlug: AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
        kind: "hypothesis",
        text: "Likely connection pool issue",
        color: "#f5a623",
      },
    ],
  },
  {
    activeSlug: AGENT_TEAM_ROLE_SLUG.codeReader,
    thinkMs: 1000,
    messages: [
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.codeReader,
        toSlug: AGENT_TEAM_ROLE_SLUG.architect,
        kind: "evidence",
        text: "Found at route.ts:42 — no try-catch",
        color: "#a855f7",
      },
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.codeReader,
        toSlug: AGENT_TEAM_ROLE_SLUG.reviewer,
        kind: "evidence",
        text: "No error boundary on line 42",
        color: "#a855f7",
      },
    ],
  },
  {
    activeSlug: AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
    thinkMs: 1200,
    messages: [
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
        toSlug: AGENT_TEAM_ROLE_SLUG.architect,
        kind: "answer",
        text: "Pool exhaustion confirmed — size 20→5",
        color: "#22c55e",
      },
    ],
  },
  {
    activeSlug: AGENT_TEAM_ROLE_SLUG.reviewer,
    thinkMs: 1400,
    messages: [
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.reviewer,
        toSlug: AGENT_TEAM_ROLE_SLUG.architect,
        kind: "challenge",
        text: "Try-catch alone won't fix pool exhaustion",
        color: "#ef4444",
      },
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.reviewer,
        toSlug: AGENT_TEAM_ROLE_SLUG.prCreator,
        kind: "approval",
        text: "Approved — ship the fix",
        color: "#22c55e",
      },
    ],
  },
  {
    activeSlug: AGENT_TEAM_ROLE_SLUG.prCreator,
    thinkMs: 800,
    messages: [
      {
        fromSlug: AGENT_TEAM_ROLE_SLUG.prCreator,
        toSlug: AGENT_TEAM_ROLE_SLUG.architect,
        kind: "status",
        text: "PR #247 created",
        color: "#e5e5e5",
      },
    ],
  },
];

// --- Layout ---

function computeLayout(roles: AgentTeamRole[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (roles.length === 0) return positions;

  const centerX = 50;
  const centerY = 50;

  const hubRole = roles.find((r) => r.slug === AGENT_TEAM_ROLE_SLUG.architect);
  const spokes = roles.filter((r) => r.id !== hubRole?.id);

  if (hubRole) {
    positions.set(hubRole.id, { x: centerX, y: centerY });
  }

  const radius = 32;
  const startAngle = -Math.PI / 2;
  const count = hubRole ? spokes.length : roles.length;
  const layoutRoles = hubRole ? spokes : roles;

  layoutRoles.forEach((role, i) => {
    if (!hubRole && i === 0) {
      positions.set(role.id, { x: centerX, y: centerY });
      return;
    }

    const idx = hubRole ? i : i - 1;
    if (idx < 0) return;
    const adjustedCount = hubRole ? count : count - 1;
    const angle = startAngle + (idx * 2 * Math.PI) / (adjustedCount || 1);
    positions.set(role.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positions;
}

function buildCurvePath(
  from: NodePosition,
  to: NodePosition,
  containerWidth: number,
  containerHeight: number
): string {
  const x1 = (from.x / 100) * containerWidth;
  const y1 = (from.y / 100) * containerHeight;
  const x2 = (to.x / 100) * containerWidth;
  const y2 = (to.y / 100) * containerHeight;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const offset = Math.min(dist * 0.15, 40);
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;

  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

// --- Orb animation along SVG path ---

interface FlyingOrb {
  id: string;
  color: string;
  kind: string;
  pathD: string;
  progress: number;
}

function interpolateQuadBezier(pathD: string, t: number): { x: number; y: number } {
  const parts = pathD.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 6) return { x: 0, y: 0 };

  const px1 = parts[0] ?? 0;
  const py1 = parts[1] ?? 0;
  const pcx = parts[2] ?? 0;
  const pcy = parts[3] ?? 0;
  const px2 = parts[4] ?? 0;
  const py2 = parts[5] ?? 0;
  const u = 1 - t;
  return {
    x: u * u * px1 + 2 * u * t * pcx + t * t * px2,
    y: u * u * py1 + 2 * u * t * pcy + t * t * py2,
  };
}

// --- Main Component ---

export function TeamGraphView({
  team,
  canManage,
  onRemoveRole,
  onRemoveEdge,
  onOpenAddRole,
  onOpenAddEdge,
}: TeamGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  // Demo state
  const [demoRunning, setDemoRunning] = useState(false);
  const [activeNodeSlug, setActiveNodeSlug] = useState<string | null>(null);
  const [orbs, setOrbs] = useState<FlyingOrb[]>([]);
  const [demoCaption, setDemoCaption] = useState<string | null>(null);
  const demoAbortRef = useRef(false);
  const orbIdCounter = useRef(0);

  const positions = useMemo(() => computeLayout(team.roles), [team.roles]);

  const measureContainer = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    measureContainer();
    window.addEventListener("resize", measureContainer);
    return () => window.removeEventListener("resize", measureContainer);
  }, [measureContainer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when role count changes
  useEffect(() => {
    measureContainer();
  }, [team.roles.length, measureContainer]);

  // --- Slug → ID lookup ---
  const slugToId = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of team.roles) {
      map.set(role.slug, role.id);
    }
    return map;
  }, [team.roles]);

  // --- Orb animation loop ---
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (orbs.length === 0) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    let lastTime = performance.now();
    const speed = 0.0015; // progress per ms (~650ms flight)

    function tick(now: number) {
      const dt = now - lastTime;
      lastTime = now;

      setOrbs((prev) => {
        const next = prev
          .map((orb) => ({ ...orb, progress: orb.progress + speed * dt }))
          .filter((orb) => orb.progress < 1);
        return next;
      });

      animationRef.current = requestAnimationFrame(tick);
    }

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [orbs.length]); // restart loop when orbs appear/disappear

  // --- Launch an orb ---
  function launchOrb(fromSlug: string, toSlug: string, color: string, kind: string) {
    const fromId = slugToId.get(fromSlug);
    const toId = slugToId.get(toSlug);
    if (!fromId || !toId) return;

    const fromPos = positions.get(fromId);
    const toPos = positions.get(toId);
    if (!fromPos || !toPos) return;

    const pathD = buildCurvePath(fromPos, toPos, dimensions.width, dimensions.height);
    orbIdCounter.current += 1;

    setOrbs((prev) => [
      ...prev,
      {
        id: `orb-${orbIdCounter.current}`,
        color,
        kind,
        pathD,
        progress: 0,
      },
    ]);
  }

  // --- Build a demo script from the team's actual connections ---
  const connectedPairs = useMemo(() => {
    const pairs = new Set<string>();
    for (const edge of team.edges) {
      const sourceRole = team.roles.find((r) => r.id === edge.sourceRoleId);
      const targetRole = team.roles.find((r) => r.id === edge.targetRoleId);
      if (sourceRole && targetRole) {
        pairs.add(`${sourceRole.slug}:${targetRole.slug}`);
      }
    }
    return pairs;
  }, [team.edges, team.roles]);

  function buildDemoScript(): DemoTurn[] {
    // Filter the hardcoded script: only keep messages where a connection exists
    const filteredTurns: DemoTurn[] = [];

    for (const turn of DEMO_SCRIPT) {
      if (!slugToId.has(turn.activeSlug)) continue;

      const validMessages = turn.messages.filter((msg) => {
        if (!slugToId.has(msg.toSlug)) return false;
        // Message is valid only if there's an edge in the exact direction: from→to
        return connectedPairs.has(`${msg.fromSlug}:${msg.toSlug}`);
      });

      if (validMessages.length > 0) {
        filteredTurns.push({ ...turn, messages: validMessages });
      }
    }

    return filteredTurns;
  }

  // --- Demo runner ---
  async function runDemo() {
    if (demoRunning) {
      demoAbortRef.current = true;
      return;
    }

    if (team.roles.length < 2 || team.edges.length < 1) return;

    const script = buildDemoScript();
    if (script.length === 0) return;

    demoAbortRef.current = false;
    setDemoRunning(true);
    setDemoCaption("Starting simulation...");

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        const check = setInterval(() => {
          if (demoAbortRef.current) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 50);
      });

    for (const turn of script) {
      if (demoAbortRef.current) break;

      const visual = getRoleVisual(turn.activeSlug as Parameters<typeof getRoleVisual>[0]);
      setActiveNodeSlug(turn.activeSlug);
      setDemoCaption(`${visual.archetype.replace("The ", "")} is thinking...`);

      await sleep(turn.thinkMs);
      if (demoAbortRef.current) break;

      for (let i = 0; i < turn.messages.length; i++) {
        const msg = turn.messages[i] as DemoMessage;

        setDemoCaption(`${msg.kind}: "${msg.text}"`);
        launchOrb(msg.fromSlug, msg.toSlug, msg.color, msg.kind);

        if (i < turn.messages.length - 1) {
          await sleep(200);
        }
      }

      await sleep(800);
    }

    if (!demoAbortRef.current) {
      setDemoCaption("Simulation complete");
      await sleep(1500);
    }

    setDemoRunning(false);
    setActiveNodeSlug(null);
    setOrbs([]);
    setDemoCaption(null);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden border border-border bg-card"
        style={{
          height: "clamp(380px, 50vh, 560px)",
          backgroundImage: "radial-gradient(circle, hsl(var(--muted) / 0.4) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* SVG connection lines + orbs */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 1 }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="8"
              refX="9"
              refY="4"
              orient="auto"
            >
              <polygon points="0 0, 10 4, 0 8" style={{ fill: "#737373" }} />
            </marker>
          </defs>

          {team.edges.map((edge) => {
            const fromPos = positions.get(edge.sourceRoleId);
            const toPos = positions.get(edge.targetRoleId);
            if (!fromPos || !toPos) return null;

            const isHovered = hoveredEdge === edge.id;
            const sourceRole = team.roles.find((r) => r.id === edge.sourceRoleId);
            const sourceVisual = sourceRole ? getRoleVisual(sourceRole.slug) : null;
            const lineColor = isHovered && sourceVisual ? sourceVisual.color : "#737373";

            return (
              <g key={edge.id}>
                <path
                  d={buildCurvePath(fromPos, toPos, dimensions.width, dimensions.height)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
                <path
                  d={buildCurvePath(fromPos, toPos, dimensions.width, dimensions.height)}
                  fill="none"
                  stroke={lineColor}
                  strokeOpacity={isHovered ? 0.9 : 0.4}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  strokeDasharray={isHovered ? "none" : "6 4"}
                  markerEnd="url(#arrowhead)"
                  className="transition-all duration-300"
                />
                <EdgeLabel
                  fromPos={fromPos}
                  toPos={toPos}
                  containerWidth={dimensions.width}
                  containerHeight={dimensions.height}
                  visible={isHovered}
                  sourceLabel={sourceRole?.label ?? ""}
                  targetLabel={team.roles.find((r) => r.id === edge.targetRoleId)?.label ?? ""}
                />
                {isHovered && canManage && !demoRunning ? (
                  <EdgeRemoveButton
                    fromPos={fromPos}
                    toPos={toPos}
                    containerWidth={dimensions.width}
                    containerHeight={dimensions.height}
                    onRemove={() => void onRemoveEdge(edge.id)}
                  />
                ) : null}
              </g>
            );
          })}

          {/* Flying orbs */}
          {orbs.map((orb) => {
            const pos = interpolateQuadBezier(orb.pathD, orb.progress);
            return (
              <g key={orb.id}>
                {/* Glow */}
                <circle cx={pos.x} cy={pos.y} r={10} fill={orb.color} opacity={0.15} />
                {/* Core */}
                <circle cx={pos.x} cy={pos.y} r={5} fill={orb.color} opacity={0.9} />
                {/* Bright center */}
                <circle cx={pos.x} cy={pos.y} r={2} fill="white" opacity={0.8} />
              </g>
            );
          })}
        </svg>

        {/* Role nodes */}
        <div className="absolute inset-0" style={{ zIndex: 2 }}>
          {team.roles.map((role) => {
            const pos = positions.get(role.id);
            if (!pos) return null;
            const visual = getRoleVisual(role.slug);
            const isHub = role.slug === AGENT_TEAM_ROLE_SLUG.architect;
            const isActive = activeNodeSlug === role.slug;
            const Icon = visual.icon;

            return (
              <Tooltip key={role.id}>
                <TooltipTrigger asChild>
                  <div
                    className="absolute group cursor-default transition-transform duration-300"
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: `translate(-50%, -50%) ${isActive ? "scale(1.06)" : "scale(1)"}`,
                    }}
                  >
                    {/* Hub radar rings */}
                    {isHub ? (
                      <>
                        <div
                          className="absolute inset-[-8px] rounded-lg opacity-0 animate-ping"
                          style={{
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: `${visual.color}33`,
                            animationDuration: "3s",
                          }}
                        />
                        <div
                          className="absolute inset-[-16px] rounded-lg opacity-0 animate-ping"
                          style={{
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: `${visual.color}1a`,
                            animationDuration: "3s",
                            animationDelay: "1.5s",
                          }}
                        />
                      </>
                    ) : null}

                    {/* Node card */}
                    <div
                      className="relative bg-card border px-4 py-3 shadow-md transition-all duration-300 group-hover:shadow-lg group-hover:scale-[1.03]"
                      style={{
                        minWidth: isHub ? 180 : 160,
                        borderColor: isActive
                          ? visual.color
                          : isHub
                            ? `${visual.color}66`
                            : "hsl(var(--border))",
                        boxShadow: isActive
                          ? `0 0 20px ${visual.color}40, 0 0 40px ${visual.color}15`
                          : undefined,
                      }}
                    >
                      {/* Top accent line */}
                      <div
                        className="absolute top-0 left-0 right-0 h-[2px]"
                        style={{ backgroundColor: visual.color }}
                      />

                      <div className="flex items-center gap-2 mb-1.5">
                        <div
                          className="flex items-center justify-center w-6 h-6 rounded-full shrink-0"
                          style={{
                            backgroundColor: `${visual.color}1a`,
                            color: visual.color,
                          }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-medium truncate">{role.label}</span>
                        {isHub ? (
                          <Badge
                            variant="outline"
                            className="ml-auto text-[0.6rem] px-1.5 py-0"
                            style={{
                              borderColor: `${visual.color}44`,
                              color: visual.color,
                            }}
                          >
                            <RiStarLine className="w-2.5 h-2.5 mr-0.5" />
                            HUB
                          </Badge>
                        ) : null}
                      </div>

                      <p
                        className="text-[0.6rem] italic mb-2"
                        style={{ color: `${visual.color}cc` }}
                      >
                        {visual.archetype}
                      </p>

                      <div className="flex flex-wrap gap-1">
                        {role.model ? (
                          <Badge variant="secondary" className="text-[0.55rem] px-1.5 py-0">
                            {role.model}
                          </Badge>
                        ) : null}
                        {role.toolIds.map((toolId) => (
                          <Badge
                            key={toolId}
                            variant="outline"
                            className="text-[0.55rem] px-1.5 py-0"
                          >
                            {toolId}
                          </Badge>
                        ))}
                      </div>

                      {/* Active indicator (thinking dots) */}
                      {isActive ? (
                        <div
                          className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[0.6rem] font-medium flex items-center gap-1"
                          style={{ color: visual.color }}
                        >
                          <span className="animate-pulse">thinking...</span>
                        </div>
                      ) : null}

                      {/* Remove button */}
                      {canManage && !demoRunning ? (
                        <button
                          type="button"
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onRemoveRole(role.id);
                          }}
                        >
                          <RiCloseLine className="w-3 h-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium mb-1">{role.label}</p>
                  <p className="text-xs text-muted-foreground">{visual.flavorText}</p>
                  {role.description ? (
                    <p className="text-xs text-muted-foreground mt-1 border-t border-border pt-1">
                      {role.description}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Demo caption bar */}
        {demoCaption ? (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 bg-card border border-border px-4 py-1.5 shadow-lg text-xs text-muted-foreground max-w-md truncate"
            style={{ zIndex: 10 }}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
            {demoCaption}
          </div>
        ) : null}

        {/* Empty state */}
        {team.roles.length === 0 ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ zIndex: 3 }}
          >
            <div className="border-2 border-dashed border-muted-foreground/20 rounded-lg p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                Add your first role to build the team graph
              </p>
              {canManage ? (
                <Button variant="outline" size="sm" onClick={onOpenAddRole}>
                  <RiAddLine className="w-4 h-4 mr-1" />
                  Add role
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Floating action buttons */}
        {team.roles.length > 0 ? (
          <div className="absolute bottom-3 right-3 flex gap-2" style={{ zIndex: 5 }}>
            {/* Demo button */}
            {team.roles.length >= 2 && team.edges.length >= 1 ? (
              <Button
                variant={demoRunning ? "destructive" : "secondary"}
                size="sm"
                onClick={() => void runDemo()}
              >
                {demoRunning ? (
                  <>
                    <RiStopLine className="w-3.5 h-3.5 mr-1" />
                    Stop
                  </>
                ) : (
                  <>
                    <RiPlayLine className="w-3.5 h-3.5 mr-1" />
                    Demo
                  </>
                )}
              </Button>
            ) : null}
            {canManage && !demoRunning ? (
              <>
                <Button variant="outline" size="sm" onClick={onOpenAddRole}>
                  <RiAddLine className="w-3.5 h-3.5 mr-1" />
                  Add role
                </Button>
                {team.roles.length >= 2 ? (
                  <Button variant="outline" size="sm" onClick={onOpenAddEdge}>
                    <RiAddLine className="w-3.5 h-3.5 mr-1" />
                    Add connection
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {/* Legend */}
        {team.roles.length > 0 && !demoRunning ? (
          <div
            className="absolute bottom-3 left-3 flex items-center gap-3 text-[0.6rem] text-muted-foreground"
            style={{ zIndex: 5 }}
          >
            <span className="flex items-center gap-1.5">
              <svg aria-hidden="true" width="24" height="10">
                <line
                  x1="0"
                  y1="5"
                  x2="18"
                  y2="5"
                  stroke="#737373"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <polygon points="16,2 22,5 16,8" fill="#737373" />
              </svg>
              can message
            </span>
            <span className="flex items-center gap-1">
              <RiStarLine className="w-3 h-3" style={{ color: "#f5a623" }} />
              hub (starts first)
            </span>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

// --- Helper components ---

function edgeMidpoint(
  fromPos: NodePosition,
  toPos: NodePosition,
  containerWidth: number,
  containerHeight: number
) {
  return {
    x: ((fromPos.x + toPos.x) / 2 / 100) * containerWidth,
    y: ((fromPos.y + toPos.y) / 2 / 100) * containerHeight,
  };
}

function EdgeLabel({
  fromPos,
  toPos,
  containerWidth,
  containerHeight,
  visible,
  sourceLabel,
  targetLabel,
}: {
  fromPos: NodePosition;
  toPos: NodePosition;
  containerWidth: number;
  containerHeight: number;
  visible: boolean;
  sourceLabel: string;
  targetLabel: string;
}) {
  if (!visible) return null;
  const mid = edgeMidpoint(fromPos, toPos, containerWidth, containerHeight);
  const labelWidth = 180;
  const labelHeight = 20;

  return (
    <foreignObject
      x={mid.x - labelWidth / 2}
      y={mid.y - labelHeight - 14}
      width={labelWidth}
      height={labelHeight}
    >
      <div
        className="text-[0.6rem] text-center text-muted-foreground whitespace-nowrap"
        style={{ pointerEvents: "none" }}
      >
        {sourceLabel} → {targetLabel}
      </div>
    </foreignObject>
  );
}

function EdgeRemoveButton({
  fromPos,
  toPos,
  containerWidth,
  containerHeight,
  onRemove,
}: {
  fromPos: NodePosition;
  toPos: NodePosition;
  containerWidth: number;
  containerHeight: number;
  onRemove: () => void;
}) {
  const mid = edgeMidpoint(fromPos, toPos, containerWidth, containerHeight);

  return (
    <foreignObject x={mid.x - 10} y={mid.y - 10} width={20} height={20}>
      <button
        type="button"
        className="w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:scale-110 transition-transform"
        style={{ pointerEvents: "auto" }}
        onClick={onRemove}
      >
        <RiCloseLine className="w-3 h-3" />
      </button>
    </foreignObject>
  );
}
