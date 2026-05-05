import java.util.*;

public class Main {
    public List<String> generateParenthesis(int n) {
        int _tid_3253 = Tracer.enter("generateParenthesis", n);
        List<String> res = new ArrayList<>();
        backtrack(res, 0, 0, n, new StringBuilder());
        return Tracer.exit(_tid_3253, res);
    }

    public void backtrack(List<String> res, int op, int cl, int n, StringBuilder curr){
        int _tid_3511 = Tracer.enter("backtrack", res, op, cl, n, curr);
        System.out.printf("%d %d\n",op, cl);
        if(op == n && cl == n){
            res.add(curr.toString());
            return;
        }
        if(op > n || cl > n)
            return;
        if(op > cl){
            curr.append("(");
            backtrack(res, op + 1, cl, n, curr);
            curr.deleteCharAt(curr.length() - 1);
            curr.append(")");
            backtrack(res, op, cl + 1, n, curr);
            curr.deleteCharAt(curr.length() - 1);
        }
        if(cl == op){
            curr.append("(");
            backtrack(res, op + 1, cl, n, curr);
            curr.deleteCharAt(curr.length() - 1);
        }

    }
    public static void main(String[] args) {
        System.out.println(generateParenthesis(3)); // Output: 2
    }
}