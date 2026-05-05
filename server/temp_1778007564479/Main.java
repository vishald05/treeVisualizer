public class Main {
    Long[] dp;

    public static int numDecodings(String s) {
        int _tid_4502 = Tracer.enter("numDecodings", s);
        if (s.charAt(0) == '0') return 0;
        dp = new Long[s.length()];
        return Tracer.exit(_tid_4502, (int) rec(0, s));
    }

    public static long rec(int ind, String s) {
        int _tid_403 = Tracer.enter("rec", ind, s);
        if (ind == s.length())
            return Tracer.exit(_tid_403, 1);

        if (dp[ind] != null)
            return Tracer.exit(_tid_403, dp[ind]);

        long res = 0;

        if (s.charAt(ind) != '0')
            res += rec(ind + 1, s);

        if (ind + 1 < s.length()) {
            if (s.charAt(ind) == '1')
                res += rec(ind + 2, s);
            if (s.charAt(ind) == '2' && s.charAt(ind + 1) <= '6')
                res += rec(ind + 2, s);
        }

        return Tracer.exit(_tid_403, dp[ind] = res);
    }

    public static void main(String[] args) {
        System.out.println(numDecodings("12")); // Output: 2
    }
}