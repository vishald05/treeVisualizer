
import java.util.*;
import com.google.gson.*; // We'll use a simple JSON builder instead to avoid deps

public class Tracer {
    public static class Step {
        String type;
        int nodeId;
        String label;
        Integer parentId;
        Object value;

        Step(String t, int id, String l, Integer p) {
            type = t; nodeId = id; label = l; parentId = p;
        }
    }

    public static class Node {
        int id;
        String label;
        Object value;
        List<Node> children = new ArrayList<>();

        Node(int id, String l) { this.id = id; this.label = l; }
    }

    private static List<Map<String, Object>> steps = new ArrayList<>();
    private static Map<Integer, Node> nodes = new HashMap<>();
    private static Stack<Integer> stack = new Stack<>();
    private static int idCounter = 0;

    public static int enter(String name, Object... args) {
        int id = idCounter++;
        Integer parentId = stack.isEmpty() ? null : stack.peek();
        
        StringBuilder label = new StringBuilder(name + "(");
        for(int i=0; i<args.length; i++) {
            label.append(args[i]);
            if(i < args.length-1) label.append(",");
        }
        label.append(")");
        
        Map<String, Object> step = new HashMap<>();
        step.put("type", "CALL");
        step.put("nodeId", id);
        step.put("label", "Calling " + label);
        step.put("parentId", parentId);
        steps.add(step);

        Node node = new Node(id, label.toString());
        nodes.put(id, node);
        if(parentId != null) nodes.get(parentId).children.add(node);
        
        stack.push(id);
        return id;
    }

    public static <T> T exit(int id, T value) {
        stack.pop();
        Node node = nodes.get(id);
        node.value = value;

        Map<String, Object> step = new HashMap<>();
        step.put("type", "RETURN");
        step.put("nodeId", id);
        step.put("label", node.label + " returned " + value);
        step.put("value", value);
        steps.add(step);

        return value;
    }

    public static void printResults() {
        // Find roots (nodes with no parents among the set)
        List<Node> roots = new ArrayList<>();
        Set<Integer> childIds = new HashSet<>();
        for(Node n : nodes.values()) {
            for(Node c : n.children) childIds.add(c.id);
        }
        for(Node n : nodes.values()) {
            if(!childIds.contains(n.id)) roots.add(n);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("steps", steps);
        result.put("tree", roots.isEmpty() ? null : roots.get(0));

        System.out.println("---JSON_START---");
        System.out.println(mapToJson(result));
        System.out.println("---JSON_END---");
    }

    // Simple manual JSON conversion to avoid external dependencies
    private static String mapToJson(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) return "\"\" + obj + "\"\"";
        if (obj instanceof Number || obj instanceof Boolean) return obj.toString();
        if (obj instanceof List) {
            List<?> list = (List<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            for(int i=0; i<list.size(); i++) {
                sb.append(mapToJson(list.get(i)));
                if(i < list.size()-1) sb.append(",");
            }
            return sb.append("]").toString();
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            int i = 0;
            for(Map.Entry<?, ?> entry : map.entrySet()) {
                sb.append("\"").append(entry.getKey()).append("\":").append(mapToJson(entry.getValue()));
                if(i++ < map.size()-1) sb.append(",");
            }
            return sb.append("}").toString();
        }
        if (obj instanceof Node) {
            Node n = (Node) obj;
            return "{\"id\":" + n.id + ",\"label\":\"" + n.label + "\",\"value\":" + mapToJson(n.value) + ",\"children\":" + mapToJson(n.children) + "}";
        }
        return "\"" + obj.toString() + "\"";
    }
}
