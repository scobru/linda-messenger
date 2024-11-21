import React from 'react';
import { gun, user, DAPP_NAME, blocking, messaging } from '../../protocol';
import { userUtils } from '../../protocol/src/utils/userUtils';
import { removeFriend, acceptFriendRequest, rejectFriendRequest } from '../../protocol/src/friends';
import { toast } from 'react-hot-toast';

const { userBlocking } = blocking;
const { chat } = messaging;

// Componente per la richiesta di amicizia
const FriendRequest = ({ request, onRequestProcessed }) => {
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [displayName, setDisplayName] = React.useState('Unknown');

  // Effetto per caricare il nome dell'utente che ha inviato la richiesta
  React.useEffect(() => {
    const loadSenderName = async () => {
      try {
        // Ottieni il nome dal nodo userList/users
        const userData = await new Promise((resolve) => {
          gun.get(DAPP_NAME)
            .get('userList')
            .get('users')
            .get(request.from)
            .once((data) => {
              resolve(data);
            });
        });

        if (userData?.nickname) {
          setDisplayName(userData.nickname);
          return;
        }

        // Prova a ottenere il nickname
        const nickname = await new Promise((resolve) => {
          gun.get(DAPP_NAME)
            .get('userList')
            .get('nicknames')
            .get(request.from)
            .once((data) => {
              resolve(data);
            });
        });

        if (nickname) {
          setDisplayName(nickname);
          return;
        }

        // Fallback all'alias originale
        const user = await gun.get(`~${request.from}`).once();
        if (user?.alias) {
          setDisplayName(user.alias.split('.')[0]);
          return;
        }

        // Fallback finale alla chiave pubblica abbreviata
        setDisplayName(`${request.from.slice(0, 6)}...${request.from.slice(-4)}`);
      } catch (error) {
        console.error('Errore nel caricamento del nome:', error);
      }
    };

    loadSenderName();
  }, [request.from]);

  const handleAccept = async () => {
    try {
      setIsProcessing(true);
      const result = await acceptFriendRequest(request);
      
      if (result.success) {
        // Rimuovi immediatamente la richiesta dall'UI
        onRequestProcessed(request.from);

        // Rimuovi la richiesta da Gun
        gun.get(DAPP_NAME)
          .get('all_friend_requests')
          .map()
          .once((data, key) => {
            if (data && data.from === request.from) {
              gun.get(DAPP_NAME)
                .get('all_friend_requests')
                .get(key)
                .put(null);
            }
          });

        gun.get(DAPP_NAME)
          .get('friend_requests')
          .get(user.is.pub)
          .map()
          .once((data, key) => {
            if (data && data.from === request.from) {
              gun.get(DAPP_NAME)
                .get('friend_requests')
                .get(user.is.pub)
                .get(key)
                .put(null);
            }
          });

        toast.success('Richiesta di amicizia accettata');
      }
    } catch (error) {
      console.error('Errore accettazione richiesta:', error);
      toast.error('Errore nell\'accettare la richiesta');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    try {
      setIsProcessing(true);
      await rejectFriendRequest(request);

      // Rimuovi immediatamente la richiesta dall'UI
      onRequestProcessed(request.from);

      // Rimuovi la richiesta da Gun
      gun.get(DAPP_NAME)
        .get('all_friend_requests')
        .map()
        .once((data, key) => {
          if (data && data.from === request.from) {
            gun.get(DAPP_NAME)
              .get('all_friend_requests')
              .get(key)
              .put(null);
          }
        });

      gun.get(DAPP_NAME)
        .get('friend_requests')
        .get(user.is.pub)
        .map()
        .once((data, key) => {
          if (data && data.from === request.from) {
            gun.get(DAPP_NAME)
              .get('friend_requests')
              .get(user.is.pub)
              .get(key)
              .put(null);
          }
        });

      toast.success('Richiesta di amicizia rifiutata');
    } catch (error) {
      console.error('Errore rifiuto richiesta:', error);
      toast.error('Errore nel rifiutare la richiesta');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg shadow-sm mb-2">
      <div className="flex items-center">
        <img
          className="h-10 w-10 rounded-full"
          src={`https://api.dicebear.com/7.x/bottts/svg?seed=${displayName}&backgroundColor=b6e3f4`}
          alt=""
        />
        <div className="ml-3">
          <p className="text-sm font-medium text-gray-900">
            {displayName}
          </p>
          <p className="text-xs text-gray-500">
            {new Date(request.timestamp).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="flex space-x-2">
        <button
          onClick={handleAccept}
          disabled={isProcessing}
          className={`px-3 py-1 text-sm font-medium text-white bg-blue-500 rounded hover:bg-blue-600 
            ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessing ? 'In corso...' : 'Accetta'}
        </button>
        <button
          onClick={handleReject}
          disabled={isProcessing}
          className={`px-3 py-1 text-sm font-medium text-white bg-red-500 rounded hover:bg-red-600
            ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Rifiuta
        </button>
      </div>
    </div>
  );
};

export default function Friends({ onSelect, loading, selectedUser }) {
  const [friends, setFriends] = React.useState([]);
  const [pendingRequests, setPendingRequests] = React.useState([]);
  const friendsRef = React.useRef(new Map());
  const [activeMenu, setActiveMenu] = React.useState(null);
  const [blockedUsers, setBlockedUsers] = React.useState(new Set());
  const blockedUsersRef = React.useRef(new Set());

  // Funzione per gestire la rimozione delle richieste processate
  const handleRequestProcessed = (fromPub) => {
    // Rimuovi immediatamente la richiesta dalla lista locale
    setPendingRequests(prev => prev.filter(r => r.from !== fromPub));
  };

  React.useEffect(() => {
    if (!user?.is) return;

    let mounted = true;
    const unsubscribers = new Map();

    const updateFriendData = async (friendPub) => {
      if (!mounted) return;
      
      // Sottoscrizione al nickname dell'amico
      const unsubNickname = gun.get(DAPP_NAME)
        .get('userList')
        .get('nicknames')
        .get(friendPub)
        .on((nickname) => {
          if (!mounted) return;
          
          setFriends(prev => prev.map(friend => {
            if (friend.pub === friendPub) {
              return {
                ...friend,
                alias: nickname || `${friendPub.slice(0, 6)}...${friendPub.slice(-4)}`
              };
            }
            return friend;
          }));
        });

      unsubscribers.set(friendPub, unsubNickname);
    };

    // Monitora la lista amici
    const unsubFriendships = gun.get(DAPP_NAME)
      .get('friendships')
      .map()
      .on((friendship, id) => {
        if (!friendship || !mounted) return;

        if (friendship.user1 === user.is.pub || friendship.user2 === user.is.pub) {
          const friendPub = friendship.user1 === user.is.pub ? friendship.user2 : friendship.user1;
          
          if (!friendsRef.current.has(friendPub)) {
            friendsRef.current.set(friendPub, true);
            
            // Aggiorna la lista amici
            setFriends(prev => {
              const exists = prev.some(f => f.pub === friendPub);
              if (!exists) {
                return [...prev, {
                  pub: friendPub,
                  alias: `${friendPub.slice(0, 6)}...${friendPub.slice(-4)}`,
                  friendshipId: id,
                  added: friendship.created,
                  type: 'friend'
                }];
              }
              return prev;
            });

            // Sottoscrivi agli aggiornamenti del nickname
            updateFriendData(friendPub);
          }
        }
      });

    return () => {
      mounted = false;
      unsubscribers.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
      if (typeof unsubFriendships === 'function') unsubFriendships();
      friendsRef.current.clear();
    };
  }, [user?.is]);

  React.useEffect(() => {
    if (!user?.is) return;

    const unsubRequests = gun.get(DAPP_NAME)
      .get('all_friend_requests')
      .map()
      .on((request) => {
        if (request && request.to === user.is.pub) {
          setPendingRequests(prev => {
            const exists = prev.some(r => r.from === request.from);
            if (!exists) {
              return [...prev, request];
            }
            return prev;
          });
        }
      });

    return () => {
      if (typeof unsubRequests === 'function') {
        unsubRequests();
      }
    };
  }, []);

  React.useEffect(() => {
    let isSubscribed = true;

    const loadBlockedUsers = async () => {
      try {
        // Usa Promise.allSettled invece di Promise.all per gestire meglio gli errori
        const [blockedListResult, blockedChatsResult] = await Promise.allSettled([
          userBlocking.getBlockedUsers(),
          chat.getBlockedChats()
        ]);
        
        if (!isSubscribed) return;

        const blockedList = blockedListResult.status === 'fulfilled' ? blockedListResult.value : [];
        const blockedChats = blockedChatsResult.status === 'fulfilled' ? blockedChatsResult.value : [];

        const blockedSet = new Set(blockedList.map(user => user.pub));
        setBlockedUsers(blockedSet);
        blockedUsersRef.current = blockedSet;

        // Aggiorna la lista amici per riflettere lo stato di blocco
        setFriends(prev => prev.map(friend => {
          const chatId = [user.is.pub, friend.pub].sort().join('_');
          const isChatBlocked = blockedChats.includes(chatId);
          
          return {
            ...friend,
            isBlocked: blockedSet.has(friend.pub),
            canChat: !blockedSet.has(friend.pub) && !isChatBlocked
          };
        }));
      } catch (error) {
        console.error('Error loading blocked users:', error);
      }
    };

    loadBlockedUsers();

    // Ascolta gli eventi di cambio stato utente
    const handleUserStatusChange = async (event) => {
      const { type, userPub } = event.detail;
      
      if (type === 'block') {
        setBlockedUsers(prev => {
          const newSet = new Set(prev);
          newSet.add(userPub);
          blockedUsersRef.current = newSet;
          return newSet;
        });

        setFriends(prev => prev.map(friend => 
          friend.pub === userPub ? { ...friend, isBlocked: true } : friend
        ));
      } else if (type === 'unblock') {
        setBlockedUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(userPub);
          blockedUsersRef.current = newSet;
          return newSet;
        });

        setFriends(prev => prev.map(friend => 
          friend.pub === userPub ? { ...friend, isBlocked: false } : friend
        ));
      }
    };

    window.addEventListener('userStatusChanged', handleUserStatusChange);

    return () => {
      isSubscribed = false;
      window.removeEventListener('userStatusChanged', handleUserStatusChange);
    };
  }, [setFriends]);

  const handleRemoveFriend = async (friend) => {
    try {
      if (window.confirm('Sei sicuro di voler rimuovere questo amico?')) {
        await removeFriend(friend.pub);
        toast.success('Amico rimosso con successo');
        // La lista amici si aggiornerà automaticamente tramite le sottoscrizioni
      }
    } catch (error) {
      console.error('Errore rimozione amico:', error);
      toast.error('Errore durante la rimozione');
    }
  };

  const handleUnblock = async (friend) => {
    try {
      // Sblocca l'utente
      const unblockResult = await userBlocking.unblockUser(friend.pub);
      if (!unblockResult.success) {
        throw new Error(unblockResult.message);
      }
      
      // Sblocca anche la chat
      const chatId = [user.is.pub, friend.pub].sort().join('_');
      await chat.unblockChat(chatId);
      
      // Aggiorna lo stato locale
      setFriends(prev => prev.map(f => 
        f.pub === friend.pub ? { ...f, isBlocked: false } : f
      ));
      
      toast.success(`${friend.alias} è stato sbloccato`);
      setActiveMenu(null);
    } catch (error) {
      console.error('Error unblocking user:', error);
      toast.error("Errore durante lo sblocco dell'utente");
    }
  };

  const renderFriend = (friend) => {
    const isSelected = selectedUser?.pub === friend.pub;
    const isBlocked = friend.isBlocked;

    return (
      <div
        key={friend.pub}
        className={`relative flex items-center p-3 hover:bg-gray-50 cursor-pointer ${
          isSelected ? 'bg-blue-50' : ''
        } ${isBlocked ? 'opacity-50' : ''}`}
      >
        <div 
          className="flex-1 flex items-center"
          onClick={() => onSelect(friend)}
        >
          <div className="flex-shrink-0">
            <img
              className="h-10 w-10 rounded-full"
              src={`https://api.dicebear.com/7.x/bottts/svg?seed=${friend.alias}&backgroundColor=b6e3f4`}
              alt=""
            />
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-gray-900">
              {friend.alias || 'Caricamento...'}
            </p>
            <p className="text-xs text-gray-500">
              {friend.pub.slice(0, 8)}...
            </p>
          </div>
        </div>

        {/* Menu contestuale */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button 
            className="p-2 hover:bg-gray-100 rounded-full"
            onClick={() => setActiveMenu(activeMenu === friend.pub ? null : friend.pub)}
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>
          
          {activeMenu === friend.pub && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50">
              <div className="py-1">
                <button
                  onClick={() => {
                    handleRemoveFriend(friend);
                    setActiveMenu(null);
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Rimuovi amico
                </button>
                {isBlocked ? (
                  <button
                    onClick={() => {
                      handleUnblock(friend);
                      setActiveMenu(null);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50"
                  >
                    Sblocca utente
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      handleBlock(friend);
                      setActiveMenu(null);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Blocca utente
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Indicatore di blocco */}
        {isBlocked && (
          <div className="absolute top-0 right-0 m-2">
            <span className="text-xs text-red-500 bg-red-100 px-2 py-1 rounded-full">
              Bloccato
            </span>
          </div>
        )}
      </div>
    );
  };

  const handleBlock = async (friend) => {
    try {
      // Blocca l'utente
      const blockResult = await userBlocking.blockUser(friend.pub);
      if (!blockResult.success) {
        throw new Error(blockResult.message);
      }
      
      // Blocca anche la chat
      const chatId = [user.is.pub, friend.pub].sort().join('_');
      const chatBlockResult = await chat.blockChat(chatId);
      if (!chatBlockResult.success) {
        throw new Error('Errore nel blocco della chat');
      }
      
      // Aggiorna lo stato locale
      setFriends(prev => prev.map(f => 
        f.pub === friend.pub ? { ...f, isBlocked: true, canChat: false } : f
      ));
      
      // Se l'utente bloccato è quello selezionato, deselezionalo
      if (selectedUser?.pub === friend.pub) {
        onSelect(null);
      }
      
      toast.success(`${friend.alias} è stato bloccato`);
      setActiveMenu(null);
    } catch (error) {
      console.error('Error blocking user:', error);
      toast.error(`Errore durante il blocco: ${error.message}`);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Richieste in sospeso */}
      {pendingRequests?.length > 0 && (
        <div className="p-4 bg-yellow-50 rounded-lg">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">
            Richieste di amicizia ({pendingRequests.length})
          </h3>
          <div className="space-y-2">
            {pendingRequests.map((request) => (
              <FriendRequest
                key={request.pub || request.from}
                request={request}
                onRequestProcessed={handleRequestProcessed}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lista amici */}
      <div className="divide-y divide-gray-200">
        {friends.map(renderFriend)}
      </div>

      {/* Stato vuoto */}
      {!loading && friends.length === 0 && pendingRequests?.length === 0 && (
        <div className="text-center text-gray-500 py-4">
          Nessun amico trovato
        </div>
      )}
    </div>
  );
}
