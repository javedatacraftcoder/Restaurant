import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      // añade el id en la sesión por comodidad
      (session.user as any).id = token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/login",     // tu página de login personalizada
    newUser: "/app",      // nuevos usuarios → área de clientes
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
