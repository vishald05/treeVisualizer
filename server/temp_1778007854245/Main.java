import java.util.*;

public class Main {
    public static boolean wordBreak(String s, List<String> wordDict) {
        int _tid_5050 = Tracer.enter("wordBreak", s, wordDict);
        int le = s.length();
        HashSet<String> che = new HashSet<>();
        for(String word : wordDict) che.add(word);
        HashMap<String, Boolean> [] dp = new HashMap[le]; 
        return Tracer.exit(_tid_5050, rec(0, s, che, "", dp));
    }

    public static boolean rec(int ind, String s, HashSet<String> che, String curr, HashMap<String, Boolean> [] dp){
        int _tid_5835 = Tracer.enter("rec", ind, s, che, curr, HashMap<String, dp);
        if(ind == s.length()){
            return Tracer.exit(_tid_5835, che.contains(curr));
        }
        if(dp[ind] != null && dp[ind].containsKey(curr))
            return Tracer.exit(_tid_5835, dp[ind].get(curr));
        boolean c1 = false, c2 = false;
        c1 = rec(ind + 1, s, che, curr + s.charAt(ind), dp);
        if(che.contains(curr)){
            c2 = rec(ind + 1, s, che, s.charAt(ind) + "", dp);
        }
        if(dp[ind] == null) dp[ind] = new HashMap<>();
        dp[ind].put(curr, c1 || c2);
        return Tracer.exit(_tid_5835, c1 || c2);
    }
    public static void main(String[] args) {
        List<String> words = new ArrayList<>();
        String s = "leetcode";
        words.add("leet"); words.add("code");
        System.out.println(wordBreak(s, words)); // Output: 2
    }
}