import { Box, Button, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";

interface ModeHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Reusable SVG components for flow diagrams
function FlowNode({
  x,
  y,
  width,
  height,
  label,
  color,
  variant = "rect",
  textColor = "#374151",
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
  variant?: "rect" | "diamond" | "rounded";
  textColor?: string;
}) {
  const textX = x + width / 2;
  const textY = y + height / 2;

  if (variant === "diamond") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const hw = width / 2;
    const hh = height / 2;
    return (
      <g>
        <polygon
          points={`${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`}
          fill="white"
          stroke={color}
          strokeWidth="2"
        />
        <text x={textX} y={textY + 4} textAnchor="middle" fill={textColor} fontSize="11" fontFamily="system-ui">
          {label}
        </text>
      </g>
    );
  }

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={variant === "rounded" ? 16 : 6}
        fill="white"
        stroke={color}
        strokeWidth="2"
      />
      <text x={textX} y={textY + 4} textAnchor="middle" fill={textColor} fontSize="12" fontFamily="system-ui">
        {label}
      </text>
    </g>
  );
}

function FlowArrow({
  points,
  color,
  animated = true,
  label,
  labelPos,
}: {
  points: string;
  color: string;
  animated?: boolean;
  label?: string;
  labelPos?: { x: number; y: number };
}) {
  return (
    <g>
      <defs>
        <marker
          id={`arrow-${color.replace("#", "")}`}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L0,8 L10,4 Z" fill={color} />
        </marker>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        markerEnd={`url(#arrow-${color.replace("#", "")})`}
        strokeDasharray={animated ? "6 3" : "none"}
        className={animated ? "flow-arrow-animated" : undefined}
      />
      {label && labelPos && (
        <text x={labelPos.x} y={labelPos.y} fill="#6b7280" fontSize="11" fontFamily="system-ui" fontWeight="500">
          {label}
        </text>
      )}
    </g>
  );
}

// Smart Mode Diagram - larger and clearer
function SmartModeDiagram() {
  const color = "#f59e0b";
  return (
    <svg viewBox="0 0 480 140" width="100%" height="140" role="img">
      <title>Smart mode flow diagram</title>
      <defs>
        <pattern id="grid-smart" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(245, 158, 11, 0.08)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-smart)" />

      {/* Client Node */}
      <FlowNode x={10} y={30} width={70} height={36} label="Client" color={color} />

      {/* Arrow to Decision */}
      <FlowArrow points="80,48 120,48" color={color} />

      {/* Decision Diamond - Mock exists? */}
      <FlowNode x={120} y={20} width={90} height={56} label="Mock exists?" color={color} variant="diamond" />

      {/* Yes path - to Return Mock */}
      <FlowArrow points="210,48 260,48" color={color} label="YES" labelPos={{ x: 225, y: 40 }} />
      <FlowNode x={260} y={30} width={100} height={36} label="Return Mock" color={color} variant="rounded" />

      {/* No path - down to Server */}
      <FlowArrow
        points="165,76 165,100 200,100"
        color={color}
        animated={false}
        label="NO"
        labelPos={{ x: 172, y: 92 }}
      />
      <FlowNode x={200} y={82} width={80} height={36} label="Server" color="#64748b" />

      {/* Arrow from Server to Save & Return */}
      <FlowArrow points="280,100 320,100" color={color} />
      <FlowNode x={320} y={82} width={120} height={36} label="Save & Return" color={color} variant="rounded" />
    </svg>
  );
}

// Proxy Mode Diagram
function ProxyModeDiagram() {
  const color = "#10b981";
  return (
    <svg viewBox="0 0 480 80" width="100%" height="80" role="img">
      <title>Proxy mode flow diagram</title>
      <defs>
        <pattern id="grid-proxy" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(16, 185, 129, 0.08)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-proxy)" />

      {/* Client Node */}
      <FlowNode x={40} y={22} width={70} height={36} label="Client" color={color} />

      {/* Arrow to Server */}
      <FlowArrow points="110,40 170,40" color={color} />

      {/* Server Node */}
      <FlowNode x={170} y={22} width={80} height={36} label="Server" color="#64748b" />

      {/* Arrow to Return */}
      <FlowArrow points="250,40 310,40" color={color} />

      {/* Return Node */}
      <FlowNode x={310} y={22} width={90} height={36} label="Return" color={color} variant="rounded" />
    </svg>
  );
}

// Record Mode Diagram
function RecordModeDiagram() {
  const color = "#ef4444";
  return (
    <svg viewBox="0 0 480 80" width="100%" height="80" role="img">
      <title>Record mode flow diagram</title>
      <defs>
        <pattern id="grid-record" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(239, 68, 68, 0.08)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-record)" />

      {/* Recording indicator */}
      <circle cx={22} cy={40} r={8} fill={color} className="pulse-animation" />

      {/* Client Node */}
      <FlowNode x={50} y={22} width={70} height={36} label="Client" color={color} />

      {/* Arrow to Server */}
      <FlowArrow points="120,40 180,40" color={color} />

      {/* Server Node */}
      <FlowNode x={180} y={22} width={80} height={36} label="Server" color="#64748b" />

      {/* Arrow to Save & Return */}
      <FlowArrow points="260,40 320,40" color={color} />

      {/* Save & Return Node */}
      <FlowNode x={320} y={22} width={120} height={36} label="Save & Return" color={color} variant="rounded" />
    </svg>
  );
}

// Mock Mode Diagram
function MockModeDiagram() {
  const color = "#3b82f6";
  return (
    <svg viewBox="0 0 480 140" width="100%" height="140" role="img">
      <title>Mock mode flow diagram</title>
      <defs>
        <pattern id="grid-mock" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(59, 130, 246, 0.08)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-mock)" />

      {/* Client Node */}
      <FlowNode x={10} y={30} width={70} height={36} label="Client" color={color} />

      {/* Arrow to Decision */}
      <FlowArrow points="80,48 120,48" color={color} />

      {/* Decision Diamond - Mock exists? */}
      <FlowNode x={120} y={20} width={90} height={56} label="Mock exists?" color={color} variant="diamond" />

      {/* Yes path - to Return Mock */}
      <FlowArrow points="210,48 260,48" color={color} label="YES" labelPos={{ x: 225, y: 40 }} />
      <FlowNode x={260} y={30} width={100} height={36} label="Return Mock" color={color} variant="rounded" />

      {/* No path - down to Error */}
      <FlowArrow
        points="165,76 165,100 220,100"
        color="#ef4444"
        animated={false}
        label="NO"
        labelPos={{ x: 172, y: 92 }}
      />
      <FlowNode
        x={220}
        y={82}
        width={80}
        height={36}
        label="Error"
        color="#ef4444"
        variant="rounded"
        textColor="#ef4444"
      />
    </svg>
  );
}

// Mode Card Component
function ModeCard({
  icon,
  name,
  color,
  description,
  children,
}: {
  icon: string;
  name: string;
  color: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      bg="white"
      borderRadius="xl"
      border="1px solid"
      borderColor="gray.200"
      overflow="hidden"
      transition="all 0.2s"
      boxShadow="sm"
      _hover={{
        borderColor: color,
        boxShadow: "md",
      }}
    >
      {/* Header */}
      <HStack px={5} py={4} bg="gray.50" borderBottom="1px solid" borderColor="gray.100" gap={3}>
        <Box
          w={10}
          h={10}
          borderRadius="lg"
          bg={color}
          display="flex"
          alignItems="center"
          justifyContent="center"
          fontSize="lg"
          fontWeight="bold"
          color="white"
          boxShadow={`0 2px 8px ${color}40`}
        >
          {icon}
        </Box>
        <VStack align="start" gap={0}>
          <Text fontWeight="700" color="gray.800" fontSize="md">
            {name}
          </Text>
          <Text fontSize="sm" color="gray.500">
            {description}
          </Text>
        </VStack>
      </HStack>

      {/* Diagram */}
      <Box p={4} bg="white">
        {children}
      </Box>
    </Box>
  );
}

// CSS animations for SVG elements
const svgStyles = `
  @keyframes flowArrow {
    0% { stroke-dashoffset: 18; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .flow-arrow-animated {
    animation: flowArrow 0.6s linear infinite;
  }
  .pulse-animation {
    animation: pulse 1.5s ease-in-out infinite;
    transform-origin: center;
    transform-box: fill-box;
  }
`;

export function ModeHelpDialog({ isOpen, onClose }: ModeHelpDialogProps) {
  return (
    <DialogRoot size="full" open={isOpen} onOpenChange={(e) => !e.open && onClose()}>
      <style>{svgStyles}</style>
      <DialogContent bg="gray.50" color="gray.800" maxW="100vw" maxH="100vh">
        <DialogCloseTrigger color="gray.500" _hover={{ color: "gray.800" }} />
        <DialogHeader borderBottom="1px solid" borderColor="gray.200" bg="white" py={4}>
          <DialogTitle fontSize="xl" fontWeight="700" letterSpacing="-0.02em">
            <HStack gap={2}>
              <Text>🐕</Text>
              <Text color="gray.800">snaperro</Text>
              <Text color="gray.400">/</Text>
              <Text color="gray.600">Mode Guide</Text>
            </HStack>
          </DialogTitle>
          <Text fontSize="sm" color="gray.500" mt={1}>
            Understanding how each proxy mode handles your requests
          </Text>
        </DialogHeader>

        <DialogBody py={6} px={8} overflow="auto">
          <Grid templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }} gap={6} maxW="1200px" mx="auto">
            <ModeCard
              icon="★"
              name="Smart Mode"
              color="#f59e0b"
              description="Intelligent mock-first with fallback recording"
            >
              <SmartModeDiagram />
            </ModeCard>

            <ModeCard icon="→" name="Proxy Mode" color="#10b981" description="Direct passthrough to real server">
              <ProxyModeDiagram />
            </ModeCard>

            <ModeCard icon="●" name="Record Mode" color="#ef4444" description="Capture responses for future mocking">
              <RecordModeDiagram />
            </ModeCard>

            <ModeCard icon="◆" name="Mock Mode" color="#3b82f6" description="Strict mock-only responses">
              <MockModeDiagram />
            </ModeCard>
          </Grid>

          {/* Legend */}
          <HStack mt={6} pt={4} justify="center" gap={8} flexWrap="wrap">
            <HStack gap={2}>
              <Box w={4} h={4} borderRadius="md" bg="white" border="2px solid" borderColor="gray.400" />
              <Text fontSize="sm" color="gray.600">
                Node
              </Text>
            </HStack>
            <HStack gap={2}>
              <Box w={5} h={5} transform="rotate(45deg)" bg="white" border="2px solid" borderColor="gray.400" />
              <Text fontSize="sm" color="gray.600">
                Decision
              </Text>
            </HStack>
            <HStack gap={2}>
              <Box w={4} h={4} borderRadius="full" bg="white" border="2px solid" borderColor="gray.400" />
              <Text fontSize="sm" color="gray.600">
                Result
              </Text>
            </HStack>
            <HStack gap={2}>
              <Box w={8} h="2px" bg="gray.400" className="flow-arrow-animated" />
              <Text fontSize="sm" color="gray.600">
                Data Flow
              </Text>
            </HStack>
          </HStack>

          {/* Usage tips */}
          <Box
            mt={6}
            p={5}
            bg="white"
            borderRadius="lg"
            border="1px solid"
            borderColor="gray.200"
            maxW="1200px"
            mx="auto"
          >
            <Text fontWeight="600" color="gray.700" mb={3}>
              💡 Usage Tips
            </Text>
            <VStack align="start" gap={2} fontSize="sm" color="gray.600">
              <Text>
                • <strong>Smart Mode</strong> is recommended for daily development - it uses mocks when available and
                records new responses automatically.
              </Text>
              <Text>
                • Use <strong>Record Mode</strong> when you want to capture all responses from the real server.
              </Text>
              <Text>
                • Use <strong>Mock Mode</strong> for offline testing or when you want to ensure no real API calls are
                made.
              </Text>
              <Text>
                • <strong>Proxy Mode</strong> is useful when you want to bypass mocking entirely.
              </Text>
            </VStack>
          </Box>
        </DialogBody>

        <DialogFooter borderTop="1px solid" borderColor="gray.200" bg="white" py={4}>
          <Button onClick={onClose} colorPalette="gray" variant="outline">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
